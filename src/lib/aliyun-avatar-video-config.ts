export type LingMouVariableNames = {
  text: string;
};

export type LingMouVariableInput = {
  text: string;
  voiceOfficialId: string;
  avatarOfficialId: string;
  names: LingMouVariableNames;
};

function requiredVariableName(value: string, type: keyof LingMouVariableNames) {
  const name = value.trim();
  if (!name || name.length > 120 || /[\u0000-\u001f]/.test(name)) {
    throw new Error(`灵眸 ${type} 模板变量名无效`);
  }
  return name;
}

export function validateLingMouTemplateVariables(
  variables: ReadonlyArray<{ name?: string; type?: string }> | undefined,
  names: LingMouVariableNames,
) {
  const textName = requiredVariableName(names.text, 'text');
  if (!variables?.some(variable => variable.name === textName && variable.type === 'text')) {
    throw new Error(`灵眸模板未发布所需变量或变量类型不匹配：${textName}(text)。请先在阿里云配置并发布文本变量；当前请求未提交合成`);
  }
}

export function createLingMouVariables(input: LingMouVariableInput) {
  return [
    {
      name: requiredVariableName(input.names.text, 'text'),
      type: 'text',
      properties: { content: input.text },
    },
    {
      type: 'voice',
      properties: { resourceId: input.voiceOfficialId },
    },
    {
      type: 'avatar',
      properties: { resourceId: input.avatarOfficialId },
    },
  ];
}

export function normalizeLingMouVideoStatus(status: string | undefined) {
  switch (status?.trim().toUpperCase()) {
    case 'SUCCESS':
    case 'SUCCEEDED':
    case 'COMPLETED':
      return 'SUCCESS';
    case 'ERROR':
    case 'FAIL':
    case 'FAILED':
      return 'ERROR';
    case 'CANCELED':
    case 'CANCELLED':
      return 'CANCELED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'INIT':
    case 'CREATED':
    case 'QUEUED':
    case 'PENDING':
      return 'QUEUED';
    default:
      return 'PROCESSING';
  }
}
