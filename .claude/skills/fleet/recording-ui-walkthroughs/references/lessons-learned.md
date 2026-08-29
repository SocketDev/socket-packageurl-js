# Rules that came from getting this wrong

- **Bound the scroll step, not its duration.** A scroll eased over a fixed frame
  count still reads as a cut when the distance is large, and an ease-out curve is
  worse - it puts most of the distance in the first frame.
- **Glide before clicking.** Playwright scrolls an element into view itself, in
  one jump, before acting on it. Glide first and there is nothing left for it to
  do.
- **Do not dither a GIF.** UI is flat colour; dithering scatters noise across it
  and destroys between-frame compression. With downscaling that took one
  recording from 4.3MB to 712KB; the same recording as H.264 is 132KB.
- **Match the ripple.** If a UI ripples the current step, reuse the recorder's
  ripple duration so the two read as one language.
- **Hide dev-only chrome** before the first frame. A framework's dev badge in a
  customer-facing recording is scaffolding shipped as product.
