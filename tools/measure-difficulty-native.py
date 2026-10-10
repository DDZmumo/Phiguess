"""Extract only scalar text motion. No source pixels are shipped or replayed."""
from pathlib import Path
import json
import numpy as np
from PIL import Image

root=Path('storage/references/difficulty');out=Path('output/playwright/difficulty-frame-review')
previous=json.loads(Path('apps/web/src/difficulty-reference.json').read_text())
levels=['ez','hd','in','at'];origins=[207,309,411,513]

def read(level,frame):
    a=np.asarray(Image.open(root/level/'frames'/f'{frame+1:04d}.jpg').convert('L'),dtype=np.float32)
    bg=np.median(np.r_[a[:20,:20].ravel(),a[-20:,-20:].ravel()])
    return np.maximum(bg-a if bg>80 else a-bg,0)

def spans(signal):
    active=np.flatnonzero(signal);runs=[]
    for x in active:
        if runs and x-runs[-1][1]==1:runs[-1][1]=int(x)
        else:runs.append([int(x),int(x)])
    return runs

def isolate(image,count):
    for threshold in range(max(20,int(image.max()*.3)),int(image.max()),3):
        parts=[r for r in spans(image.max(0)>threshold) if r[1]-r[0]>=1]
        if len(parts)==count:return parts
    raise RuntimeError(f'Cannot isolate {count} glyphs (peak {image.max()}): {parts}')

def smooth_series(values,radius=2):
    values=np.asarray(values,dtype=float)
    values=np.array([np.median(values[max(0,i-1):min(len(values),i+2)]) for i in range(len(values))]);result=[]
    for i in range(len(values)):
        lo=max(0,i-radius);hi=min(len(values),i+radius+1)
        result.append(float(np.polynomial.polynomial.polyfit(np.arange(lo,hi)-i,values[lo:hi],min(2,hi-lo-1))[0]))
    return np.array(result)

def regularize(frames,scores,chosen):
    raw=np.array(frames,dtype=float);result=raw.copy();confidence=np.array(scores);windows={}
    order=np.arange(4)-1.5
    for word,level in enumerate(levels):
        start=word*4;initial_x=np.array([g['x']-360 for g in glyphs[start:start+4]])
        if level==chosen:
            shift=np.median(raw[:,start:start+4,0]-initial_x,axis=1)
            group=np.median(raw[:,start:start+3,0]-initial_x[:3],axis=1)
            shift=smooth_series(shift,3);group=smooth_series(group,3)
            arrow=smooth_series(raw[:,start+3,0],3)
            shift-=shift[0];group-=group[0];arrow-=arrow[0]-initial_x[3]
            if initial_x.mean()>0:shift[:49]=np.minimum.accumulate(shift[:49])
            else:shift[:49]=np.maximum.accumulate(shift[:49])
            group[49:]=np.minimum.accumulate(group[49:]);arrow[49:]=np.maximum.accumulate(arrow[49:])
            for frame in range(len(raw)):
                if frame<49:result[frame,start:start+4,0]=initial_x+shift[frame]
                else:
                    result[frame,start:start+3,0]=initial_x[:3]+group[frame]
                    result[frame,start+3,0]=arrow[frame]
                result[frame,start:start+4,1]=1
            continue
        shifts=[];spacings=[];valid=[]
        for frame in range(len(raw)):
            alpha=raw[frame,start:start+4,1];good=(alpha>.15)&(confidence[frame,start:start+4]>.82)
            if np.count_nonzero(good)>=2:
                design=np.stack([np.ones(4),order],axis=1)[good]
                shift,spacing=np.linalg.lstsq(design,raw[frame,start:start+4,0][good]-initial_x[good],rcond=None)[0]
                shifts.append(float(shift));spacings.append(max(0,float(spacing)));valid.append(frame)
        if not valid:continue
        at=np.arange(len(raw));shift=np.interp(at,valid,shifts);spacing=np.interp(at,valid,spacings)
        last=valid[-1]
        if len(valid)>3:
            velocity=(shifts[-1]-shifts[-4])/max(1,valid[-1]-valid[-4])
            spread=(spacings[-1]-spacings[-4])/max(1,valid[-1]-valid[-4])
            shift[last:]=shifts[-1]+(at[last:]-last)*velocity
            spacing[last:]=spacings[-1]+(at[last:]-last)*max(0,spread)
        shift=smooth_series(shift,3);shift-=shift[0]
        shift=np.maximum.accumulate(shift) if shifts[-1]>=shifts[0] else np.minimum.accumulate(shift)
        spacing=np.maximum.accumulate(np.maximum(0,smooth_series(spacing,3)));spacing-=spacing[0]
        opacity=np.quantile(raw[:,start:start+4,1],.75,axis=1)
        begins=np.flatnonzero((spacing>1.5)|(opacity<.94));begin=int(begins[0]) if len(begins) else last
        ends=np.flatnonzero((at>begin)&(opacity<.08));end=int(ends[0]) if len(ends) else min(len(raw)-1,last+3)
        extra=max(0,6-(end-begin));earlier=min(2,extra);begin=max(0,begin-earlier);end=min(len(raw)-1,end+extra-earlier)
        p=np.clip((at-begin)/max(1,end-begin),0,1);fade=1-p*p*(3-2*p)
        for frame in range(len(raw)):
            result[frame,start:start+4,0]=initial_x+shift[frame]+order*min(spacing[frame],40)
            result[frame,start:start+4,1]=fade[frame]
        windows[level]=[begin+15,end+15]
    return np.round(result,5).tolist(),windows

initial=read('at',15);glyphs=[];widths={}
for level,origin in zip(levels,origins):
    start=origin-46;parts=isolate(initial[253:293,start:origin+46],4)
    for char,(a,b) in zip(f'<{level.upper()}>',parts):
        left=start+a;right=start+b;centre=(left+right)/2
        glyphs.append({'char':char,'word':level,'x':centre,'template':initial[253:293,left-2:right+3]})
        widths.setdefault(char,[]).append(right-left+1)

traces={};caption_glyphs={};caption_opacity={};quality={};fade_windows={}
for chosen in levels:
    active=[True]*16;positions=[g['x'] for g in glyphs];alphas=[1.]*16;frames=[];scores_log=[]
    chosen_values=previous['selected'][chosen]
    for frame in range(15,72):
        a=read(chosen,frame);band=np.pad(a[253:293],((0,0),(100,100)))
        delta=0 if frame==15 else chosen_values[frame-15]-chosen_values[frame-16]
        current=[];frame_scores=[]
        for i,g in enumerate(glyphs):
            if not active[i]:current.append([round(positions[i]-360,3),0]);frame_scores.append(0);continue
            template=g['template'];width=template.shape[1];energy=float(np.sum(template*template))
            expected=positions[i]+delta
            candidates=[]
            for centre in np.arange(round(expected)-24,round(expected)+25):
                x=round(centre-width/2)+100
                if x<0 or x+width>band.shape[1]:continue
                patch=band[:,x:x+width];dot=float(np.sum(patch*template))
                score=dot/np.sqrt(max(1,float(np.sum(patch*patch))*energy))
                candidates.append((score,float(centre),dot/max(energy,1)))
            if not candidates:best=(0,expected,0)
            else:best=max(candidates,key=lambda p:p[0]-.001*abs(p[1]-expected))
            score,x,alpha=best
            if g['word']!=chosen:alpha=min(alpha,alphas[i])
            if score<.72 or alpha<.08:
                if g['word']!=chosen:active[i]=False
                alpha=0
            positions[i]=x;alphas[i]=max(0,min(1,alpha));current.append([round(x-360,3),round(alphas[i],4)]);frame_scores.append(round(score,3))
        frames.append(current);scores_log.append(frame_scores)
    frames,fade_windows[chosen]=regularize(frames,scores_log,chosen)
    held=read(chosen,110);parts=isolate(held[253:293,70:168],3)
    cap=[round(70+(a+b)/2-360,3) for a,b in parts]
    right=isolate(held[253:293,592:646],1)
    cap.append(round(592+sum(right[0])/2-360,3));caption_glyphs[chosen]=cap
    origin=origins[levels.index(chosen)]
    caption_opacity[chosen]=round(float(min(1,held[253:293,70:168].max()/initial[253:293,origin-46:origin+46].max())),4)
    caption_points=[p for p in json.loads((out/'measured-motion.json').read_text())['caption'] if p[0]!=86]
    for frame in range(72,111):
        at=float(np.interp(frame,[p[0] for p in caption_points],[p[1] for p in caption_points]))
        left_delta=at+241;right_delta=(389+max(0,-at-8)/233*230)-618
        current=[[round(x-360,3),0] for x in positions]
        start=levels.index(chosen)*4
        for part in range(4):current[start+part]=[round(cap[part]+(left_delta if part<3 else right_delta),3),1]
        frames.append(current)
    traces[chosen]=frames;quality[chosen]=scores_log

# Fit the unoccluded caption's outward motion. The left caption becomes obscured
# by a new reel before it leaves the screen, so its lost track is not an opacity cue.
held=read('at',110);right=isolate(held[253:293,592:646],1)[0]
left=592+right[0]-2;width=right[1]-right[0]+5
template=held[253:293,left:left+width];template=template[2:]-template[:-2];energy=float(np.sum(template*template))
last=left;samples=[]
for frame in range(110,301):
    band=read('at',frame)[253:293];band=band[2:]-band[:-2];best=(-1,last)
    for x in range(max(0,last-2),min(720-width,last+16)+1):
        patch=band[:,x:x+width];score=float(np.sum(patch*template))/np.sqrt(max(1,float(np.sum(patch*patch))*energy))
        if score>best[0]:best=(score,x)
    if best[0]>.65:last=best[1]
    if frame>=220 and best[0]>.65:samples.append([frame,last-left])
time=np.array([p[0]/30-167/30 for p in samples]);distance=np.array([p[1] for p in samples])
coefficient=float(np.dot(time**4,distance)/np.dot(time**4,time**4))
result={'labelGlyphs':[g['char'] for g in glyphs],'glyphWidths':{c:float(np.median(w)) for c,w in widths.items()},
        'nativeLabels':traces,'captionGlyphs':caption_glyphs,'captionOpacity':caption_opacity,'labelFadeWindows':fade_windows,'outwardCoefficient':round(coefficient,8)}
(out/'native-label-motion.json').write_text(json.dumps(result,separators=(',',':')))
(out/'native-label-tracking-quality.json').write_text(json.dumps(quality))
print(json.dumps({'glyphs':len(result['labelGlyphs']),'outwardCoefficient':coefficient,'captionOpacity':caption_opacity,
 'fadeWindows':fade_windows},indent=2))
