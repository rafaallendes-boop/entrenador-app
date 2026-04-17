# Design System: Elite Performance Coach IA
**Project ID:** 6867761149903456764

## 1. Visual Theme & Atmosphere
Obsidian Forge is a high-octane, editorial design system built for performance, intensity, and precision. It eschews the safe corporate SaaS aesthetic in favor of a raw, industrial, yet premium look. The system thrives on the tension between deep obsidian surfaces and molten, spectral accents. It relies on a "dark-on-dark" layering strategy to create a sense of infinite space where data acts as a tactical HUD rather than a static database. The atmosphere is undeniably elite, kinetic, and immersive. 

To elevate the experience, the system incorporates high-quality, dynamic imagery of elite athletes engaged in intense training, rather than relying on generic placeholders. The HUD is further brought to life with kinetic micro-interactions and animations, such as pulsating indicators and smooth hover states, creating a responsive and engaging environment.

## 2. Color Palette & Roles
*   **Obsidian Depth** (#0e0e0e) - The core background color, providing the infinite, dark space for the HUD.
*   **Molten Primary** (#FF4D00) - Used for primary actions, critical emphasis, and peak performance moments.
*   **Heat Secondary** (#E62100) - Used for data visualizations, secondary active paths, and metabolic alerts.
*   **Tactical Gray variant** (#adaaaa) - Used for body text and neutral information to reduce eye strain against the dark background.
*   **White Frost** (#ffffff) - Used sparingly for key metrics ("on_surface") to provide maximum high-end contrast.
*   **Phantom Outline** (rgba(255, 255, 255, 0.1)) - Used for barely-there ghost borders that define container edges without adding solid lines.

## 3. Typography Rules
The system employs a high-contrast pairing of **Lexend** (for authority) and **Inter** (for precision).
*   **Display / Headers:** Lexend Black, uppercase with -0.05em letter spacing. It establishes a blocky, heavy-duty editorial feel. Used for high-impact metrics (e.g., heart rate, pace) to dwarf surrounding body text.
*   **Utility & Data:** Inter Medium/Regular. Used for long-form analysis, descriptions, and functional data points. 
*   **Labels:** Inter Black, always uppercase with 0.2em - 0.3em letter-spacing to ensure readability at small sizes while maintaining that premium tactical identity.

## 4. Component Stylings
*   **Buttons:** 
    *   *Primary/Spectral:* Generously rounded (`rounded-xl`), Lexend Black, uppercase, applying spectral gradient backgrounds with a 30px diffused shadow glow of the primary color. Buttons must feature subtle scaler animations on hover or press to feel highly tactile.
    *   *Secondary/Ghost:* Pill-shaped (`rounded-full`), glassmorphism transparent background, with a 10% opacity white ghost border.
*   **Cards/Containers:** Bento-style "glass-card" layouts with 16px to 24px subtle roundness. Backgrounds are tinted slightly (`rgba(255, 255, 255, 0.05)`) with a 24px backdrop blur and a 1px ghost border (`outline-variant`) to separate them from the pure obsidian backdrop. Critical cards should have smooth fade-in animations on scroll.
*   **Inputs/Forms:** Translucent backgrounds with a ghost border (`white/10`). Instead of a full box outline on focus, it triggers a primary color "glow" line underneath, accompanied by a quick, responsive animation transition.
*   **Imagery:** Only dynamic, high-contrast, premium photography of athletes (e.g., sprinting, lifting, focused). Standard generic gradients inside media containers must be replaced with these intense workout visuals.

## 5. Layout Principles
*   **Intentional Asymmetry:** The design rejects rigid, boxy constraints in favor of an asymmetric, kinetic editorial experience. High impact metrics are placed off-center to create visual energy.
*   **No-Line Rule:** The UI uses tonal layering rather than solid 1px strokes to divide sections. Boundaries are created through background shifts (`surface-container` overlays).
*   **Depth by Layering:** Shadows are shunned except for elements that float. The primary method for showing hierarchy is stacking progressively lighter translucent obsidian cards over the baseline. Use a 135-degree linear gradient on specific high-impact elements to create a natural lighting effect.
