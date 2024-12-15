import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import globals from 'globals';
import js from '@eslint/js';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory : __dirname,
    recommendedConfig : js.configs.recommended,
    allConfig : js.configs.all
});

export default [{
    ignores : ['dist/*'],
}, ...compat.extends('eslint:recommended'), {
    languageOptions : {
        globals : {
            ...globals.browser,
            ...globals.node,
            ...globals.es2021
        },

        ecmaVersion : 'latest',
        sourceType : 'module'
    },

    rules : {
        'array-callback-return' : 'error',
        'arrow-body-style' : ['error', 'as-needed'],
        'arrow-spacing' : ['error', { before : true, after : true }],
        'block-scoped-var' : 'error',
        'brace-style' : ['error', '1tbs', { allowSingleLine : true }],
        'comma-spacing' : ['error', { before : false, after : true }],
        complexity : 'error',
        'consistent-this' : 'error',
        'dot-notation' : 'error',
        'eol-last' : ['error', 'always'],
        eqeqeq : ['error', 'smart'],
        'guard-for-in' : 'error',
        indent : ['error', 4, { SwitchCase : 1, ObjectExpression : 'first' }],
        'key-spacing' : ['error', { beforeColon : true, mode : 'minimum' }],
        'keyword-spacing' : 'error',
        'linebreak-style' : ['error', 'windows'],
        'logical-assignment-operators' : ['error', 'always'],
        'max-len' : ['error', { code : 140 }],
        'max-nested-callbacks' : ['error', 3],
        'no-constant-binary-expression' : 'error',
        'no-constructor-return' : 'error',
        'no-duplicate-imports' : 'error',
        'no-else-return' : 'error',
        'no-eq-null' : 'error',
        'no-eval' : 'error',
        'no-extra-bind' : 'error',
        'no-implicit-globals' : 'error',
        'no-invalid-this' : 'error',
        'no-label-var' : 'error',
        'no-lone-blocks' : 'error',
        'no-lonely-if' : 'error',
        'no-loop-func' : 'error',
        'no-negated-condition' : 'error',
        'no-new-native-nonconstructor' : 'error',
        'no-promise-executor-return' : 'error',
        'no-self-compare' : 'error',
        'no-shadow' : 'error',
        'no-template-curly-in-string' : 'error',
        'no-throw-literal' : 'error',
        'no-trailing-spaces' : ['error'],
        'no-unmodified-loop-condition' : 'error',
        'no-unneeded-ternary' : 'error',
        'no-unused-expressions' : ['error', { allowTernary : true }],
        'no-unused-private-class-members' : 'error',
        'no-unused-vars' : ['error', {
            argsIgnorePattern : '^_',
            varsIgnorePattern : '^_',
            caughtErrorsIgnorePattern : '^_',
        }],
        'no-use-before-define' : 'off',
        'no-useless-call' : 'error',
        'no-useless-concat' : 'error',
        'no-useless-rename' : 'error',
        'no-useless-return' : 'error',
        'no-var' : 'error',
        'object-curly-spacing' : ['error', 'always'],
        'object-shorthand' : ['error', 'consistent-as-needed'],
        'operator-assignment' : 'error',
        'operator-linebreak' : ['error', 'after', {
            overrides : {
                '||' : 'before',
                '&&' : 'before'
            },
        }],
        'padding-line-between-statements' : ['error',
            { blankLine : 'always', prev : 'block-like', next : '*' },
            { blankLine : 'any', prev : '*', next : 'break' },
            { blankLine : 'any', prev : '*', next : 'case' },
            { blankLine : 'any', prev : '*', next : 'default' }
        ],
        'prefer-const' : 'error',
        'prefer-named-capture-group' : 'error',
        'prefer-promise-reject-errors' : 'error',
        'prefer-object-spread' : 'error',
        'prefer-regex-literals' : 'error',
        'prefer-rest-params' : 'error',
        'quote-props' : ['error', 'as-needed'],
        quotes : ['error', 'single', {
            avoidEscape : true,
            allowTemplateLiterals : true,
        }],
        'require-atomic-updates' : 'error',
        'require-await' : 'error',
        'rest-spread-spacing' : ['error', 'never'],
        semi : ['error', 'always'],
        'semi-spacing' : ['error', { before : false, after : true }],
        'semi-style' : ['error', 'last'],
        'sort-imports' : ['error', { ignoreCase : true, allowSeparatedGroups : true }],
        'space-in-parens' : ['error', 'never'],
        yoda : ['error', 'never'],
    },
}];
