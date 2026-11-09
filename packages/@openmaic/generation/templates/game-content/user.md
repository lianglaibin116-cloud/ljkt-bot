Create an educational GAME widget for: {{title}}

## Game Type

{{gameType}}

## Description

{{description}}

## Key Points

{{keyPoints}}

## Scoring Configuration

{{scoring}}

## Language

{{languageDirective}}

---

Generate a FUN, INTERACTIVE HTML game with these MANDATORY features:

### Game Design (CRITICAL - NOT A QUIZ!)
1. **Interactive gameplay**: Player MUST control something meaningful (NOT just click answers)
2. **Real game mechanics**: Timing, aiming, dragging, balancing, catching, or building
3. **Skill-based success**: Outcome depends on player action, not just correct answer
4. **Engaging feedback**: Animations, sounds, visual effects for actions

### Preferred Game Types (in order of preference)
1. **Physics/Action**: Control parameters to achieve a goal (land safely, hit target, balance)
2. **Timing/Aim**: Click at right moment or adjust aim to succeed
3. **Drag-and-drop**: Sort, arrange, or build by dragging elements
4. **Simulation game**: Let player experiment with variables to find solution
5. **Card/Match**: Memory or matching games
6. **Quiz**: ONLY as last resort - make it visually interesting

### Simulation Integration (if game has visual simulation)
- Simulation MUST be interactive (player controls something)
- Simulation physics MUST match what player is learning
- Visual feedback MUST show player's progress toward goal
- Example: Don't ask "What thrust?" → LET PLAYER ADJUST thrust and see result!

### Game Elements
1. **Clear objective**: "Land safely", "Hit the target", "Sort correctly"
2. **Player controls**: Sliders, buttons, drag areas, or click targets
3. **Real-time feedback**: Score, progress bar, visual indicators
4. **Levels or challenges**: Progressive difficulty
5. **Achievement system**: Unlockable badges for accomplishments
6. **Replay value**: Random elements or multiple solutions

### Visual Design
1. Attractive theme matching the subject
2. Clear UI for controls and feedback
3. Animations for success/failure
4. Responsive layout (mobile + desktop)

### Technical (MANDATORY)
1. **Inline onclick for start button**: `<button onclick="startGame()">开始</button>` - NOT addEventListener
2. **Immediate submit/confirm**: Every question, round, or level where the player selects, drags, sorts, matches, or builds an answer MUST show an always-visible Submit/Confirm button as soon as the round starts. Never require waiting for the countdown to reach zero.
3. **Immediate progression**: Submit freezes the current timer and validates at once. After feedback, show a Next Question/Next Level button or auto-advance within 1.5 seconds. The timer may affect score or cause timeout, but must never gate progression after submission.
4. **Callable progression API**: Implement global `submitCurrentChallenge()` and `nextChallenge()` functions, and bind the controls with inline `onclick` attributes. Keep buttons inside the viewport at all supported iframe sizes.
5. **Custom CSS preferred**: Avoid Tailwind `@layer utilities` blocks; use plain CSS
6. **DOMContentLoaded wrapper**: Wrap game code in `document.addEventListener('DOMContentLoaded', ...)`
7. **Global start function**: `function startGame()` must be callable from onclick
8. Embedded `<script type="application/json" id="widget-config">`
9. `requestAnimationFrame` for smooth animations
10. Touch-friendly controls (min 44px touch targets)
11. localStorage for progress/high scores
12. Pause functionality

### Output
Return ONLY the HTML document. Make the game FUN enough that students want to play again!
