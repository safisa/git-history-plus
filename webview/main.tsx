import './styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { post } from './rpc';
import { getAppStore } from './store';

// The store subscribes to pushes before 'ready' is posted, so the `init` reply cannot be missed.
// On `init` the store applies mode/query/settings and loads the first page.
const store = getAppStore();
const root = document.getElementById('root');
if (root) createRoot(root).render(<App store={store} />);
post({ type: 'ready' });
