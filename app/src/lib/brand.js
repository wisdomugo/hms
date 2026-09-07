/*
 * What this product is called.
 *
 * One constant rather than a string typed into four screens, because the
 * rename that created this file is the argument for it: the name was in
 * App.jsx, Login.jsx, Setup.jsx twice, and index.html, and finding all five
 * took a search rather than a glance. The next change to it — capitalisation,
 * a tagline, a white-labelled build for a hospital that wants its own name on
 * the product — should be one edit.
 *
 * NOT the hospital's name. That comes from the API, per installation, and
 * always takes visual precedence: the people using this work at the hospital,
 * not at Clinisynx.
 */
export const PRODUCT = 'Clinisynx - HMS';

/*
 * index.html carries the same string in its <title>, because the page title
 * has to exist before any JavaScript runs — a tab that says "Vite + React"
 * for half a second on every load is worse than a duplicated constant. If you
 * change PRODUCT, change app/index.html too. It is the only copy.
 */
