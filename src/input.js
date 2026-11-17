// Restoring an answer after a rejected submission should leave it editable at
// the same caret/selection. A saved answer with no selection starts at the end.
export function focusAnswer(input, selection = null) {
  input.focus({preventScroll:true});
  const end = input.value.length;
  input.setSelectionRange(Math.min(selection?.start ?? end, end),
    Math.min(selection?.end ?? end, end), selection?.direction || 'none');
}
