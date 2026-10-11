import {version} from '../../../package.json';

/** Application release metadata; shared by the public health endpoint and title screen. */
export const APP_VERSION=version;
export const APP_VERSION_LABEL=APP_VERSION.replace(/-preview$/,' Preview');
