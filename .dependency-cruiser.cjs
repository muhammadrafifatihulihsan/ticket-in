/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies must be avoided to prevent initialization deadlocks.',
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: 'domain-cannot-import-outer-layers',
      severity: 'error',
      comment: 'Domain layer must remain pure business logic and cannot import outer layers.',
      from: {
        path: '^src/modules/[^/]+/domain/',
      },
      to: {
        path: '^src/modules/[^/]+/(infrastructure|interface|application)/',
      },
    },
    {
      name: 'platform-cannot-import-modules',
      severity: 'error',
      comment: 'Platform layer must be completely agnostic of domain modules.',
      from: {
        path: '^src/platform/',
      },
      to: {
        path: '^src/modules/',
      },
    },
    {
      name: 'strict-module-encapsulation',
      severity: 'error',
      comment:
        'A module cannot import another module internal files; cross-module access must go through index.ts.',
      from: {
        path: '^src/modules/([^/]+)/',
      },
      to: {
        path: '^src/modules/([^/]+)/',
        pathNot: ['^src/modules/$1/', '^src/modules/[^/]+/index(\\.ts)?$'],
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
  },
};
