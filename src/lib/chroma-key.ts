export type ChromaKeySettings = {
  enabled: boolean;
  color: string;
  tolerance: number;
  softness: number;
};

export const DEFAULT_CHROMA_KEY_SETTINGS: ChromaKeySettings = {
  enabled: false,
  color: '#ffffff',
  tolerance: 4,
  softness: 6,
};

type ChromaKeySettingsInput = Partial<ChromaKeySettings> | null | undefined;
type ChromaKeySource = ImageBitmap | HTMLCanvasElement | HTMLImageElement | HTMLVideoElement;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const COLOR_DISTANCE_SCALE = 100 / Math.sqrt(3 * 255 * 255);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeChromaKeySettings(
  input: ChromaKeySettingsInput,
): ChromaKeySettings {
  const tolerance = Number(input?.tolerance);
  const softness = Number(input?.softness);
  return {
    enabled: input?.enabled === true,
    color: typeof input?.color === 'string' && HEX_COLOR.test(input.color)
      ? input.color.toLowerCase()
      : DEFAULT_CHROMA_KEY_SETTINGS.color,
    tolerance: Number.isFinite(tolerance)
      ? clamp(tolerance, 0, 40)
      : DEFAULT_CHROMA_KEY_SETTINGS.tolerance,
    softness: Number.isFinite(softness)
      ? clamp(softness, 0, 40)
      : DEFAULT_CHROMA_KEY_SETTINGS.softness,
  };
}

export function chromaKeyAlpha(
  red: number,
  green: number,
  blue: number,
  input: ChromaKeySettingsInput,
): number {
  const settings = normalizeChromaKeySettings(input);
  if (!settings.enabled) return 1;
  const [keyRed, keyGreen, keyBlue] = hexToRgb(settings.color);
  const distance = Math.sqrt(
    (red - keyRed) ** 2 + (green - keyGreen) ** 2 + (blue - keyBlue) ** 2,
  ) * COLOR_DISTANCE_SCALE;
  if (distance <= settings.tolerance) return 0;
  if (!settings.softness || distance >= settings.tolerance + settings.softness) return 1;
  const position = (distance - settings.tolerance) / settings.softness;
  return position * position * (3 - 2 * position);
}

function hexToRgb(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('无法创建抠色着色器');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || '未知着色器错误';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

export class ChromaKeyRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private processingCanvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private keyColorUniform: WebGLUniformLocation | null = null;
  private toleranceUniform: WebGLUniformLocation | null = null;
  private softnessUniform: WebGLUniformLocation | null = null;
  private webglUnavailable = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
  }

  render(
    source: ChromaKeySource,
    width: number,
    height: number,
    input?: ChromaKeySettingsInput,
  ): void {
    const outputWidth = Math.max(1, Math.round(width));
    const outputHeight = Math.max(1, Math.round(height));
    if (this.canvas.width !== outputWidth || this.canvas.height !== outputHeight) {
      this.canvas.width = outputWidth;
      this.canvas.height = outputHeight;
    }
    const context = this.context;
    if (!context) return;
    const settings = normalizeChromaKeySettings(input);
    context.clearRect(0, 0, outputWidth, outputHeight);
    if (!settings.enabled) {
      context.drawImage(source, 0, 0, outputWidth, outputHeight);
      return;
    }

    if (this.renderWebgl(source, outputWidth, outputHeight, settings)) {
      context.drawImage(this.processingCanvas as HTMLCanvasElement, 0, 0);
      return;
    }
    this.renderCanvasFallback(context, source, outputWidth, outputHeight, settings);
  }

  private initializeWebgl(): boolean {
    if (this.gl && this.program && this.texture) return true;
    if (this.webglUnavailable) return false;
    try {
      const processingCanvas = document.createElement('canvas');
      const gl = processingCanvas.getContext('webgl', {
        alpha: true,
        antialias: false,
        premultipliedAlpha: false,
      });
      if (!gl) throw new Error('WebGL unavailable');
      const vertex = compileShader(gl, gl.VERTEX_SHADER, `
        attribute vec2 a_position;
        varying vec2 v_uv;
        void main() {
          vec2 canvas_uv = a_position * 0.5 + 0.5;
          v_uv = vec2(canvas_uv.x, 1.0 - canvas_uv.y);
          gl_Position = vec4(a_position, 0.0, 1.0);
        }
      `);
      const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `
        precision mediump float;
        uniform sampler2D u_image;
        uniform vec3 u_key_color;
        uniform float u_tolerance;
        uniform float u_softness;
        varying vec2 v_uv;
        void main() {
          vec4 source = texture2D(u_image, v_uv);
          float distance_percent = distance(source.rgb, u_key_color) * 57.7350269;
          float alpha = u_softness <= 0.0001
            ? step(u_tolerance, distance_percent)
            : smoothstep(u_tolerance, u_tolerance + u_softness, distance_percent);
          gl_FragColor = vec4(source.rgb, source.a * alpha);
        }
      `);
      const program = gl.createProgram();
      if (!program) throw new Error('无法创建抠色程序');
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || '抠色程序链接失败');
      }
      const position = gl.getAttribLocation(program, 'a_position');
      const buffer = gl.createBuffer();
      const texture = gl.createTexture();
      if (!buffer || !texture || position < 0) throw new Error('无法初始化抠色纹理');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      gl.useProgram(program);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // ImageBitmap ignores UNPACK_FLIP_Y_WEBGL in some browsers while
      // images and videos honor it. The shader handles orientation uniformly.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
      this.processingCanvas = processingCanvas;
      this.gl = gl;
      this.program = program;
      this.texture = texture;
      this.keyColorUniform = gl.getUniformLocation(program, 'u_key_color');
      this.toleranceUniform = gl.getUniformLocation(program, 'u_tolerance');
      this.softnessUniform = gl.getUniformLocation(program, 'u_softness');
      return true;
    } catch {
      this.webglUnavailable = true;
      this.processingCanvas = null;
      this.gl = null;
      this.program = null;
      this.texture = null;
      return false;
    }
  }

  private renderWebgl(
    source: ChromaKeySource,
    width: number,
    height: number,
    settings: ChromaKeySettings,
  ): boolean {
    if (!this.initializeWebgl()) return false;
    const processingCanvas = this.processingCanvas as HTMLCanvasElement;
    const gl = this.gl as WebGLRenderingContext;
    try {
      if (processingCanvas.width !== width || processingCanvas.height !== height) {
        processingCanvas.width = width;
        processingCanvas.height = height;
      }
      const [red, green, blue] = hexToRgb(settings.color);
      gl.viewport(0, 0, width, height);
      gl.useProgram(this.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.uniform3f(this.keyColorUniform, red / 255, green / 255, blue / 255);
      gl.uniform1f(this.toleranceUniform, settings.tolerance);
      gl.uniform1f(this.softnessUniform, settings.softness);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true;
    } catch {
      this.webglUnavailable = true;
      return false;
    }
  }

  private renderCanvasFallback(
    context: CanvasRenderingContext2D,
    source: ChromaKeySource,
    width: number,
    height: number,
    settings: ChromaKeySettings,
  ) {
    context.drawImage(source, 0, 0, width, height);
    try {
      const image = context.getImageData(0, 0, width, height);
      const [keyRed, keyGreen, keyBlue] = hexToRgb(settings.color);
      for (let index = 0; index < image.data.length; index += 4) {
        const distance = Math.sqrt(
          (image.data[index] - keyRed) ** 2
          + (image.data[index + 1] - keyGreen) ** 2
          + (image.data[index + 2] - keyBlue) ** 2,
        ) * COLOR_DISTANCE_SCALE;
        let alpha = 1;
        if (distance <= settings.tolerance) alpha = 0;
        else if (settings.softness && distance < settings.tolerance + settings.softness) {
          const position = (distance - settings.tolerance) / settings.softness;
          alpha = position * position * (3 - 2 * position);
        }
        image.data[index + 3] = Math.round(image.data[index + 3] * alpha);
      }
      context.putImageData(image, 0, 0);
    } catch {
      // A cross-origin source may forbid pixel reads; leave the opaque frame visible.
    }
  }
}
