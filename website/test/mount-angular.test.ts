import { mountSuite } from './mount-suite';

// One file per page: vitest isolates each file, so pages cannot leak state into each other.
mountSuite('angular');
