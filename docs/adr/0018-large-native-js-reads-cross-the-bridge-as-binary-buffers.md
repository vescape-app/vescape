# Large native-to-JS reads cross the bridge as NativeArrayBuffer

Any native→JS read whose size scales with row or sample count MUST cross the bridge as a little-endian `NativeArrayBuffer` (row-major numeric lanes, `NaN` for nullable floats, plus a sidecar string dictionary), decoded back into domain objects in the JS wrapper.

Why the obvious alternatives fail in Expo JSI:

- **Arrays of objects/maps** pay `fields × rows` JSI string-key allocations and boxing (seconds on a single ride).
- **`DoubleArray`** is still converted element-by-element via `pushDouble` into a `WritableArray`, not bulk-copied.
- **`ByteArray` / base64** routes through folly-dynamic strings instead of a zero-copy buffer.

Keep small bounded reads as normal maps. Native encoder and JS decoder share lane order and count by convention only — changing either side without the other silently misreads data. Values packed in `f64` lose integer precision above `2^53`.
