import test from 'node:test';
import assert from 'node:assert/strict';
import { descentDuration, descentFrame, visibleDepthRange, PIXELS_PER_METER } from '../src/descent.js';

test('a deeper result gets a longer descent, followed by a short landing',()=>{
  const scores=[10,15,30,60,85,100];
  const durations=scores.map(descentDuration);
  assert.ok(durations.every((duration,index)=>index===0||duration>durations[index-1]));
  assert.equal(descentDuration(0),800);
  assert.ok(durations[0]>=3000 && durations.at(-1)<=5500);
});

test('depth and camera use the same bounded timeline for every tier and after an earlier dive',()=>{
  for(const fromDepth of [0,580,1900]) for(const points of [10,15,30,60,85,100]) {
    const startedAt=10000,endsAt=startedAt+descentDuration(points),toDepth=fromDepth+points*10,height=900;
    let previous=fromDepth;
    for(let now=startedAt;now<=endsAt;now+=50) {
      const frame=descentFrame({fromDepth,toDepth,startedAt,endsAt,now,height});
      assert.ok(Number.isFinite(frame.surface) && Number.isFinite(frame.objectY));
      assert.ok(frame.depth>=previous-1e-6 && frame.depth<=toDepth);
      if(frame.scroll>0) assert.ok(Math.abs((frame.surface+frame.depth*PIXELS_PER_METER)-frame.objectY)<.01);
      previous=frame.depth;
    }
    const end=descentFrame({fromDepth,toDepth,startedAt,endsAt,now:endsAt,height});
    assert.equal(end.depth,toDepth);
    assert.equal(end.landed,true);
    assert.ok(end.objectY>=height*.37 && end.objectY<=height*.40);
  }
});

test('restoring uses the remaining absolute time and reduced motion lands immediately',()=>{
  const input={fromDepth:200,toDepth:1200,startedAt:1000,endsAt:6000,height:844};
  const before=descentFrame({...input,now:3000});
  const restored=descentFrame({...input,now:3000});
  const later=descentFrame({...input,now:4500});
  assert.deepEqual(restored,before);
  assert.ok(later.depth>restored.depth);
  assert.equal(descentFrame({...input,now:1100,reducedMotion:true}).depth,1200);
});

test('ruler includes the visible meters near both the surface and deep water',()=>{
  assert.deepEqual(visibleDepthRange(189,900),{from:0,to:375});
  assert.deepEqual(visibleDepthRange(-1640,900),{from:800,to:1275});
  const {from,to}=visibleDepthRange(-1640,900);
  assert.ok(-1640+from*PIXELS_PER_METER<=0);
  assert.ok(-1640+to*PIXELS_PER_METER>=900);
});
