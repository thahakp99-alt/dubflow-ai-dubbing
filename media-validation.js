const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const containers = new Set(['mov','mp4','m4a','3gp','3g2','mj2','matroska','webm','avi','mpeg','mpegvideo','asf']);
function validateMetadata(data) {
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const duration = Number(data.format?.duration);
  if (!String(data.format?.format_name).split(',').some(x=>containers.has(x)) ||
      !streams.some(x=>x.codec_type==='video' && x.codec_name && x.codec_name!=='unknown') ||
      !streams.some(x=>x.codec_type==='audio' && x.codec_name && x.codec_name!=='unknown') ||
      !Number.isFinite(duration) || duration<=0) {
    throw Object.assign(new Error('Media validation failed'), {code:'invalid_video_media'});
  }
  return {duration};
}
async function inspectVideo(filename) {
  try {
    // No shell, remote protocols, file tags, user filenames or stderr in logs.
    const {stdout} = await run('ffprobe', ['-v','error','-protocol_whitelist','file,pipe',
      '-show_entries','format=format_name,duration:stream=codec_type,codec_name',
      '-of','json',filename], {timeout:15000,maxBuffer:256*1024});
    return validateMetadata(JSON.parse(stdout));
  } catch (error) {
    throw Object.assign(new Error('Media inspection failed'), {
      code:error.code==='ENOENT'?'media_inspector_unavailable':'invalid_video_media'});
  }
}
module.exports={inspectVideo,validateMetadata};
