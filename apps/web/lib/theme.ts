/** Theme storage key, and the script that applies the saved theme before first paint (inlined in the root layout). */
export const THEME_KEY = "settle.theme";
export const themeScript = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
