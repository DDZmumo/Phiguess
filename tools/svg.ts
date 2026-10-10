import { SaxesParser } from 'saxes';

const tags=new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','defs','linearGradient','radialGradient','stop','clipPath','mask']);
const attributes=new Set(['xmlns','version','viewBox','width','height','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','d','points','fill','fill-opacity','fill-rule','stroke','stroke-width','stroke-opacity','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-dasharray','stroke-dashoffset','opacity','transform','id','clip-path','clip-rule','mask','offset','stop-color','stop-opacity','gradientUnits','gradientTransform','spreadMethod','fx','fy','fr','preserveAspectRatio','clipPathUnits','maskUnits','maskContentUnits']);

// Deliberately narrow SVG subset for static vector traces, not arbitrary SVG documents.
export function validateSvg(input: Buffer): Buffer {
  if (input.length>2*1024*1024) throw new Error('SVG exceeds 2 MiB; simplify paths first');
  const text=input.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('SVG entities and doctypes are forbidden');
  let nodes=0,depth=0,root=false;
  const parser=new SaxesParser();
  parser.on('processinginstruction',()=>{throw new Error('SVG processing instructions are forbidden');});
  parser.on('opentag',tag=>{
    if (!root) { if (tag.name!=='svg' || tag.attributes.xmlns!=='http://www.w3.org/2000/svg') throw new Error('Expected SVG root and namespace'); root=true; }
    if (!tags.has(tag.name) || ++nodes>15000 || ++depth>64) throw new Error('Unsupported or overly complex SVG');
    for (const [name,raw] of Object.entries(tag.attributes)) {
      const value=String(raw);
      if (!attributes.has(name)) throw new Error(`Unsupported SVG attribute: ${name}`);
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) || /[\\@]/.test(value)) throw new Error('Invalid SVG attribute value');
      if (/url\s*\(/i.test(value) && !/^url\(#[A-Za-z_][\w.-]*\)$/.test(value)) throw new Error('Only local SVG references allowed');
      if (/javascript:|data:|https?:|\/\//i.test(value) && !(name==='xmlns' && value==='http://www.w3.org/2000/svg')) throw new Error('External SVG references forbidden');
    }
  });
  parser.on('closetag',()=>{depth--;});
  parser.on('text',text=>{if (text.trim()) throw new Error('SVG text/metadata must be removed before import');});
  parser.on('cdata',()=>{throw new Error('SVG CDATA forbidden');});
  parser.on('comment',()=>{throw new Error('Remove SVG comments before import');});
  parser.write(text).close();
  if (!root || depth!==0) throw new Error('Invalid SVG');
  return input;
}
