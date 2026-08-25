export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_ASPECT_RATIOS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']);

function errorResponse(message: string, status: number) {
  return Response.json({ message }, { status, headers: { 'cache-control': 'no-store' } });
}

function imageMimeType(bytes: Buffer) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export async function POST(request: Request) {
  const upstream = (process.env.SEO_IMAGE_API_BASE_URL || '').replace(/\/$/, '');
  const apiKey = process.env.SEO_IMAGE_API_KEY || '';
  const model = process.env.SEO_IMAGE_MODEL || 'gemini-3.1-flash-image';
  if (!upstream || !apiKey) return errorResponse('AI 形象编辑服务尚未配置', 503);

  try {
    const input = await request.formData();
    const image = input.get('image');
    const garmentInput = input.get('garment_reference');
    const prompt = String(input.get('prompt') || '').trim();
    const requestedRatio = String(input.get('aspect_ratio') || '9:16');
    const aspectRatio = ALLOWED_ASPECT_RATIOS.has(requestedRatio) ? requestedRatio : '9:16';

    if (!(image instanceof File)) return errorResponse('请上传需要修改的形象图片', 400);
    if (!ALLOWED_IMAGE_TYPES.has(image.type)) return errorResponse('形象图片仅支持 JPG、PNG 或 WebP', 400);
    if (!image.size || image.size > MAX_IMAGE_BYTES) return errorResponse('形象图片大小必须在 20 MB 以内', 400);
    if (garmentInput !== null && !(garmentInput instanceof File)) return errorResponse('服装参考图格式无效', 400);
    const garmentReference = garmentInput instanceof File ? garmentInput : null;
    if (garmentReference && !ALLOWED_IMAGE_TYPES.has(garmentReference.type)) return errorResponse('服装参考图仅支持 JPG、PNG 或 WebP', 400);
    if (garmentReference && (!garmentReference.size || garmentReference.size > MAX_IMAGE_BYTES)) return errorResponse('服装参考图大小必须在 20 MB 以内', 400);
    if (!prompt || prompt.length > 1200) return errorResponse('修改要求长度必须在 1 到 1200 个字符之间', 400);

    const guardedPrompt = [
      garmentReference
        ? 'Use the two supplied images according to their explicitly assigned roles.'
        : 'Edit the supplied portrait according to the user request.',
      garmentReference
        ? 'Image 1 is the identity portrait. Preserve this person, face, hair, age, skin tone, body proportions and overall identity.'
        : 'Keep the same person, facial identity, age, facial proportions and skin tone unless explicitly requested otherwise.',
      ...(garmentReference ? [
        'Image 2 is a garment-only visual reference. Transfer only its clothing silhouette, cut, colors, materials, pattern and clearly visible styling details onto the person in Image 1.',
        'Do not copy the person, face, body proportions, pose, hands, background, text, watermark or unrelated objects from Image 2.',
        'Fit the referenced garment naturally to the person in Image 1 with plausible anatomy, draping and proportions.',
      ] : []),
      'Keep the result photorealistic, naturally lit, front-facing and suitable as a digital-human avatar.',
      'Do not add text, logos, watermarks, extra people or duplicated body parts.',
      `User request: ${prompt}`,
    ].join('\n');

    const body = new FormData();
    body.append('provider', 'nano_banana');
    body.append('model', model);
    body.append('prompt', guardedPrompt);
    body.append('aspect_ratio', aspectRatio);
    body.append('size', '1K');
    body.append('reference_images', image, image.name || 'avatar-reference.jpg');
    if (garmentReference) body.append('reference_images', garmentReference, garmentReference.name || 'garment-reference.jpg');

    const generated = await fetch(`${upstream}/api/ai/generate-image`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(300_000),
    });
    const payload = await generated.json() as {
      message?: unknown;
      model?: unknown;
      images?: Array<{ image_url?: unknown }>;
    };
    if (!generated.ok) {
      const detail = typeof payload.message === 'string' ? payload.message : `HTTP ${generated.status}`;
      return errorResponse(`AI 形象编辑失败：${detail}`, generated.status >= 500 ? 502 : generated.status);
    }

    const imageUrl = payload.images?.find((item) => typeof item.image_url === 'string')?.image_url;
    if (typeof imageUrl !== 'string' || !/^\/(?:data|media)\/generated\/[A-Za-z0-9._-]+$/.test(imageUrl)) {
      return errorResponse('AI 形象编辑服务没有返回可用图片', 502);
    }

    const artifact = await fetch(new URL(imageUrl, `${upstream}/`), {
      headers: { 'X-API-Key': apiKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(60_000),
    });
    if (!artifact.ok) return errorResponse('修改后的形象图片读取失败', 502);
    const bytes = Buffer.from(await artifact.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return errorResponse('修改后的形象图片大小无效', 502);
    const contentType = imageMimeType(bytes);
    if (!contentType) return errorResponse('修改后的形象图片格式无效', 502);

    return Response.json({
      image: `data:${contentType};base64,${bytes.toString('base64')}`,
      model: typeof payload.model === 'string' ? payload.model : model,
      aspectRatio,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'unknown proxy error';
    return errorResponse(`AI 形象编辑代理失败：${detail}`, 502);
  }
}
