import { registerRootComponent } from 'expo';
// The arrival task must be defined before the app renders, so the OS can wake it in the background.
import './src/arrival';
import App from './App';

registerRootComponent(App);
