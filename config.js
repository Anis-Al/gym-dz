// Settings of this installation: branding (also used for the installer names) and the week start of the weekly session limit.
// Loaded by the window (<script src="config.js">) and by the main process (require).
// Forking the app for another gym: edit this file and "name"/"description" in package.json (see "Forking" in CLAUDE.md).
const APP = {
  name: 'Gym', // sidebar logo and window title
  tagline: 'Gestion de salle', // small text under the logo (can be '')
  weekStart: 0, // first day of the week for the weekly session limit of a plan: 0 = Sunday, 1 = Monday ... 6 = Saturday
};
if (typeof module !== 'undefined') module.exports = APP;
