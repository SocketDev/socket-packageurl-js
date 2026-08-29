# Binding the steps to the picture

Only when a product team agrees to carry it. `--timeline` writes the frame spans
as a module, so the UI asks the video what time it is instead of running a clock
that drifts:

```tsx
const step = activeWalkthroughStep(timeline, video.currentTime * 1000)
```

Clicking a step is then `video.currentTime = step.startMs / 1000` plus
`pause()`, with a timer that resumes so nobody is left on a frozen frame. Ask
first: depscan's web team declined to carry this, and the plain video shipped.
