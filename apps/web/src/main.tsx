import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/rajdhani/latin-400.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/saira/latin-400.css';
import { App } from './App';
import { ShowcaseProvider } from './Showcase';
import {prepareTutorialStartup} from './tutorial-refresh';
import './style.css';
import './account.css';
import './game-alignment.css';
import './title-type.css';
import './mobile.css';

prepareTutorialStartup();
createRoot(document.getElementById('root')!).render(<React.StrictMode><ShowcaseProvider><App/></ShowcaseProvider></React.StrictMode>);
