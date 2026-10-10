// Keep one uniform scale for geometry, grain, displacement and pointer hit tests.
export function noiseViewport(width:number,height:number,referenceScale?:number){
 const scale=Math.max(.0001,referenceScale??Math.min(width/1280,height/720));
 return{scale,width:width/scale,height:height/scale,left:(1280-width/scale)/2,top:(720-height/scale)/2};
}
