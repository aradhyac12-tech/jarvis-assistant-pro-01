

## Plan: Fix Camera/Screen Startup Speed and P2P Integration in MicCamera

### Problems Identified

1. **MicCamera.tsx ignores P2P** — The page always connects through cloud relay (`CAMERA_WS_URL` hardcoded), even when local P2P is available on port 9876. This adds 200-500ms+ of unnecessary latency through the edge function relay.

2. **Unnecessary 500ms delay** — `startPcCamera` and `startScreen` both `await new Promise(r => setTimeout(r, 500))` after stopping existing streams, even on first start when there's nothing to stop.

3. **WS timeout too long** — The `waitForWsOpen` default is 10 seconds. For P2P it should be much faster (2-3s). For cloud relay, 8s is reasonable.

4. **2-second start lock** — After clicking "Start Camera", the button is locked for 2 seconds even if the stream started instantly. Should release on success.

5. **The `useCameraReceiver` and `useScreenReceiver` hooks** (used elsewhere) also have redundant P2P branching that always calls the same function on both sides of the ternary — cosmetic but confusing.

### Changes

#### 1. `src/pages/MicCamera.tsx`
- Import and use `useP2PStreaming` hook to get P2P-aware WebSocket URLs
- In `startPcCamera`: Use `p2pStreaming.getCameraUrl()` instead of hardcoded `CAMERA_WS_URL`
- In `startScreen`: Use `p2pStreaming.getScreenUrl()` instead of hardcoded `CAMERA_WS_URL`
- Skip `sendCommand("start_camera_stream")` and `sendCommand("start_screen_stream")` when P2P is active (agent handles setup directly)
- Remove the 500ms delay when there's no existing stream to stop
- Reduce start lock from 2000ms to 500ms
- Add a loading spinner state on the start button so user gets immediate feedback
- Reduce WS timeout to 5s for P2P, keep 10s for cloud

#### 2. `src/hooks/useCameraReceiver.ts` (cleanup)
- Fix the redundant ternary where both branches call the same `getCameraUrl` function

#### 3. `src/hooks/useScreenReceiver.ts` (cleanup)
- Fix the same redundant ternary for `getScreenUrl`

### Expected Impact
- **P2P mode**: Camera/screen should start in under 1 second (direct WS to PC, no edge function or command polling)
- **Cloud mode**: Saves ~500ms from unnecessary delay removal + faster lock release
- **No agent crashes**: Quality cap logic already in place, no changes needed there
- Split view, fullscreen, pinch-zoom all verified working correctly from code review

