import test from 'node:test';
import assert from 'node:assert/strict';
import { focusAnswer } from '../src/input.js';

function inputWith(value) {
  return { value, focus(options) { this.focusOptions=options; },
    setSelectionRange(start,end,direction) { this.selection={start,end,direction}; } };
}

test('restored answers retain the caret or selected text, and empty fields clamp it',()=>{
  const answer=inputWith('ลองคำตอบ');
  focusAnswer(answer,{start:4,end:4,direction:'none'});
  assert.deepEqual(answer.selection,{start:4,end:4,direction:'none'});
  assert.deepEqual(answer.focusOptions,{preventScroll:true});
  focusAnswer(answer,{start:1,end:5,direction:'backward'});
  assert.deepEqual(answer.selection,{start:1,end:5,direction:'backward'});
  answer.value='';
  focusAnswer(answer,{start:4,end:4,direction:'none'});
  assert.deepEqual(answer.selection,{start:0,end:0,direction:'none'});
});

test('saved answer text without a prior selection puts the caret at the end',()=>{
  const answer=inputWith('answer');focusAnswer(answer);
  assert.deepEqual(answer.selection,{start:6,end:6,direction:'none'});
});
