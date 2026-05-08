// Svelte mount point. Boots the app into <body>; everything else is
// delegated to the component tree.
import { mount } from "svelte";
import App from "./App.svelte";
import "./style.css";

// Touching themes early so the first paint uses the user's saved
// palette. Also subscribes the Svelte theme store to the current key.
import "./lib/stores/theme.ts";

mount(App, { target: document.body });
