# 020 Display-name receipt recovery
MODIFY gui/src/components/ModelDisplayNameDialog.tsx.
Before: input/reset enabled whenever saving=false; input onEdit clears recovery.
After: new mutationOutcomeUnknown prop from Models.tsx recovery.confirmed===false
disables draft editing and reset, submit retains
read/retry action. Handler guards prevent synthetic events bypassing disabled controls.
Close/cancel stays available. This is bounded UI recovery, not server request ordering.
MODIFY gui/tests/models-display-name-editor.test.tsx: unknown receipt cannot replace intent; retry recovers; confirmed saved:true
and ordinary validation error remain
editable. Screenshot changed disabled input/reset with retry available.

Verification: NOT RUN locally by user instruction; focused tests execute in final top-head Cross-platform CI.
