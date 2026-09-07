# Page-wide order scanning

A USB or Bluetooth keyboard-wedge scanner can open order details without first
clicking Scan order. Keep the app tab visible and focused, scan the job number,
and configure the scanner to send Enter or Tab after each barcode.

The scanner listener uses the same order-selection action as a mouse click.
It recognizes at least three characters arriving no more than 80 ms apart,
including the final suffix. Unknown orders display an error in the lookup panel.
The Scan order button remains available for manual entry or slower devices.

Input fields, text areas, editable content, select controls, composition input,
and modifier shortcuts are excluded. Click outside an editing field before
scanning. Scanning does not start production or save an order automatically.
Background tabs and other applications cannot deliver keyboard scans here.
Incomplete scans are discarded when focus or visibility changes.
