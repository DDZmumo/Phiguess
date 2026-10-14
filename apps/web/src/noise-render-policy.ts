export interface NoiseRenderPolicy {frameMs:number;maxPixels:number;maxDpr:number}
export const NOISE_RESOLUTION_SCALES=[1,.82,.67,.55,.45,.35] as const;

export function noiseRenderPolicy(mobile:boolean):NoiseRenderPolicy {
 return mobile?{frameMs:1000/60,maxPixels:960*540,maxDpr:1}:{frameMs:1000/60,maxPixels:1920*1080,maxDpr:1.5};
}

/** Backing pixels only; CSS geometry and logical hit coordinates stay unchanged. */
export function noiseBufferSize(width:number,height:number,dpr:number,policy:NoiseRenderPolicy,quality=1){
 const scale=Math.min(dpr||1,policy.maxDpr,Math.sqrt(policy.maxPixels/Math.max(1,width*height)))*quality;
 return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))};
}
