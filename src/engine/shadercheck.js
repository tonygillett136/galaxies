/**
 * Create a shader module and SURFACE ITS COMPILATION ERRORS.
 *
 * WebGPU reports a bad shader once, at module creation, and then reports the
 * consequences forever: invalid pipeline, invalid bind group, invalid command
 * buffer, several per frame. The first message names the cause and is instantly
 * buried. One reserved-keyword typo produced 198 warnings, none of which
 * mentioned the shader.
 *
 * `src/render/renderer.js` has its own private copy of this, and should be
 * migrated onto this one — logged in OPEN_ACTIONS. It lives here rather than
 * there because the engine must not import from the renderer.
 */
export async function makeShader(device, code, label) {
  const module = device.createShaderModule({ code, label });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  for (const m of info.messages) {
    const where = `${label}:${m.lineNum}:${m.linePos}`;
    if (m.type === 'error') console.error(`shader ${where} ${m.message}`);
    else console.warn(`shader ${where} ${m.message}`);
  }
  if (errors.length) {
    throw new Error(`Shader "${label}" failed to compile: ${errors[0].message} (line ${errors[0].lineNum})`);
  }
  return module;
}
