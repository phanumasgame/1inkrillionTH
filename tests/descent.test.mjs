import test from 'node:test';
import assert from 'node:assert/strict';
import { descentDuration, descentFrame, visibleDepthRange, PIXELS_PER_METER } from '../src/descent.js';

test('a deeper result gets a longer descent, followed by a short landing',()=>{
  const scores=[10,15,30,60,85,100];
  const durations=scores.map(descentDuration);
  assert.ok(durations.every((duration,index)=>index===0||duration>durations[index-1]));
  assert.equal(descentDuration(0),800);
  assert.ok(durations[0]>=1500 && durations.at(-1)<3000);
});

test('depth and camera move forward and meet the stationary camera at both ends',()=>{
  for(const height of [568,900,1440]) for(const fromDepth of [0,580,1900]) for(const points of [10,15,30,60,85,100]) {
    const startedAt=10000,endsAt=startedAt+descentDuration(points),toDepth=fromDepth+points*10;
    const input={fromDepth,toDepth,startedAt,endsAt,height};
    const stationarySurface=depth=>height*.21-Math.max(0,depth*PIXELS_PER_METER-height*.19);
    let previous=fromDepth;
    let previousSurface=stationarySurface(fromDepth);
    for(let now=startedAt;now<=endsAt;now+=10) {
      const frame=descentFrame({...input,now});
      assert.ok(Number.isFinite(frame.surface) && Number.isFinite(frame.objectY));
      assert.ok(frame.depth>=previous-1e-6 && frame.depth<=toDepth+1e-6);
      assert.ok(frame.surface<=previousSurface+1e-6);
      assert.ok(frame.objectY>=height*.37-1e-6 && frame.objectY<=height*.47+1e-6);
      if(fromDepth>0) assert.ok(Math.abs((frame.surface+frame.depth*PIXELS_PER_METER)-frame.objectY)<.01);
      previous=frame.depth;
      previousSurface=frame.surface;
    }
    const start=descentFrame({...input,now:startedAt});
    const end=descentFrame({...input,now:endsAt});
    assert.ok(Math.abs(start.surface-stationarySurface(fromDepth))<.01);
    assert.ok(Math.abs(end.surface-stationarySurface(toDepth))<.01);
    assert.equal(end.depth,toDepth);
    assert.equal(end.landed,true);
    assert.equal(end.finished,true);
  }
});

test('reveal fades in only after camera and answer settle at their final positions',()=>{
  const startedAt=1000,endsAt=startedAt+descentDuration(85);
  const input={fromDepth:300,toDepth:1150,startedAt,endsAt,height:900};
  const during=descentFrame({...input,now:endsAt-500});
  const settling=descentFrame({...input,now:endsAt-180});
  const end=descentFrame({...input,now:endsAt});
  assert.equal(during.handoff,0);
  assert.equal(during.landed,false);
  assert.ok(settling.handoff>0 && settling.handoff<1);
  assert.equal(settling.finished,false);
  assert.equal(settling.landed,true);
  assert.equal(settling.objectY,end.objectY);
  assert.equal(settling.surface,end.surface);
  assert.equal(end.handoff,1);
  assert.equal(end.finished,true);
});

test('restoring uses the remaining absolute time and reduced motion lands immediately',()=>{
  const input={fromDepth:200,toDepth:1200,startedAt:1000,endsAt:6000,height:844};
  const before=descentFrame({...input,now:3000});
  const restored=descentFrame({...input,now:3000});
  const later=descentFrame({...input,now:4500});
  assert.deepEqual(restored,before);
  assert.ok(later.depth>restored.depth);
  const reduced=descentFrame({...input,now:1100,reducedMotion:true});
  assert.equal(reduced.depth,1200);
  assert.equal(reduced.handoff,1);
});

test('ruler includes the visible meters near both the surface and deep water',()=>{
  assert.deepEqual(visibleDepthRange(189,900),{from:0,to:375});
  assert.deepEqual(visibleDepthRange(-1640,900),{from:800,to:1275});
  const {from,to}=visibleDepthRange(-1640,900);
  assert.ok(-1640+from*PIXELS_PER_METER<=0);
  assert.ok(-1640+to*PIXELS_PER_METER>=900);
});
