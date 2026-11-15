import { createWebHashHistory } from 'vue-router';
import { startApp } from '../src/app';
import { installFixtureBackend } from './fixtureBackend';
import { sampleEvening } from './fixtures';
import { mountPreviewMenu } from './previewMenu';

// The fixture backend must answer before the app sends its first request.
installFixtureBackend(sampleEvening());
startApp(createWebHashHistory());
mountPreviewMenu();
