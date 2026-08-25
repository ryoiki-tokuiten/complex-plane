const TOKEN = Object.freeze({
    NUMBER: 'number',
    IDENTIFIER: 'identifier',
    OPERATOR: 'operator',
    PUNCTUATION: 'punctuation',
    EOF: 'eof'
});

export const EXPRESSION_LIMITS = Object.freeze({
    sourceLength: 2048,
    tokenCount: 768,
    nodeCount: 512,
    depth: 64,
    identifierLength: 64,
    functionArguments: 32
});

export const FUNCTION_ARITY = Object.freeze({
    cos: [1, 1], tan: [1, 1], sec: [1, 1], asin: [1, 1], atan: [1, 1],
    exp: [1, 1], ln: [1, 1], log: [1, 1], gamma: [1, 1], loggamma: [1, 1],
    bessel: [1, 2], sinh: [1, 1], tanh: [1, 1], sqrt: [1, 1],
    zeta: [1, 1], abs: [1, 1], arg: [1, 1], re: [1, 1],
    im: [1, 1], conj: [1, 1], complex: [1, 2], floor: [1, 1], ceil: [1, 1],
    round: [1, 1], trunc: [1, 1], sign: [1, 1], min: [1, Infinity], max: [1, Infinity],
    mod: [2, 2], gcd: [2, 2], factorial: [1, 1], isPrime: [1, 1], pow: [2, 2],
    selected: [1, 1], selectedFunction: [1, 1], f: [1, 1], mobius: [1, 1],
    polynomial: [1, 1], power: [1, 1]
});

export class ExpressionSyntaxError extends Error {
    constructor(message, position, source) {
        super(`${message} at column ${position + 1}`);
        this.name = 'ExpressionSyntaxError';
        this.position = position;
        this.source = source;
    }
}

const CC_0 = 48;
const CC_9 = 57;
const CC_A = 65;
const CC_Z = 90;
const CC_a = 97;
const CC_z = 122;
const CC_UNDERSCORE = 95;
const CC_DOT = 46;
const CC_PLUS = 43;
const CC_MINUS = 45;
const CC_STAR = 42;
const CC_SLASH = 47;
const CC_CARET = 94;
const CC_BANG = 33;
const CC_LT = 60;
const CC_GT = 62;
const CC_EQ = 61;
const CC_AMP = 38;
const CC_PIPE = 124;
const CC_QUESTION = 63;
const CC_COLON = 58;
const CC_LPAREN = 40;
const CC_RPAREN = 41;
const CC_COMMA = 44;
const CC_E = 69;
const CC_e = 101;

function isDigitCode(code) {
    return code >= CC_0 && code <= CC_9;
}

function isIdentifierStartCode(code) {
    return (code >= CC_A && code <= CC_Z) || (code >= CC_a && code <= CC_z) || code === CC_UNDERSCORE;
}

function isIdentifierPartCode(code) {
    return isIdentifierStartCode(code) || isDigitCode(code);
}

function isWhitespaceCode(code) {
    return code === 32 || (code >= 9 && code <= 13) || code === 160 || code === 0xfeff;
}

function isImplicitStart(token) {
    const type = token.type;
    return type === TOKEN.NUMBER || type === TOKEN.IDENTIFIER || (type === TOKEN.PUNCTUATION && token.value === '(');
}

function syntax(message, position, source) {
    throw new ExpressionSyntaxError(message, position, source);
}

function readNumberToken(source, start) {
    let index = start;
    let sawDigit = false;
    const length = source.length;

    while (index < length && isDigitCode(source.charCodeAt(index))) {
        sawDigit = true;
        index += 1;
    }

    if (source.charCodeAt(index) === CC_DOT) {
        index += 1;
        while (index < length && isDigitCode(source.charCodeAt(index))) {
            sawDigit = true;
            index += 1;
        }
    }

    if (!sawDigit) syntax('Invalid numeric literal', start, source);

    const marker = source.charCodeAt(index);
    if (marker === CC_e || marker === CC_E) {
        const exponentStart = index++;
        const sign = source.charCodeAt(index);
        if (sign === CC_PLUS || sign === CC_MINUS) index += 1;
        const digitStart = index;
        while (index < length && isDigitCode(source.charCodeAt(index))) index += 1;
        if (digitStart === index) syntax('Invalid exponent', exponentStart, source);
    }

    const value = Number(source.slice(start, index));
    if (!Number.isFinite(value)) {
        syntax('Numeric literal is outside the supported range', start, source);
    }

    return { type: TOKEN.NUMBER, value, start, end: index };
}

function keywordOperator(raw) {
    if (raw.length === 3) {
        const c0 = raw.charCodeAt(0) | 32;
        const c1 = raw.charCodeAt(1) | 32;
        const c2 = raw.charCodeAt(2) | 32;
        if (c0 === 97 && c1 === 110 && c2 === 100) return '&&';
        if (c0 === 110 && c1 === 111 && c2 === 116) return '!';
    } else if (raw.length === 2) {
        const c0 = raw.charCodeAt(0) | 32;
        const c1 = raw.charCodeAt(1) | 32;
        if (c0 === 111 && c1 === 114) return '||';
    }
    return raw;
}

function readIdentifierToken(source, start) {
    let index = start + 1;
    const length = source.length;
    while (index < length && isIdentifierPartCode(source.charCodeAt(index))) index += 1;

    const raw = source.slice(start, index);
    if (raw.length > EXPRESSION_LIMITS.identifierLength) {
        syntax(`Identifiers may contain at most ${EXPRESSION_LIMITS.identifierLength} characters`, start, source);
    }
    const value = keywordOperator(raw);
    return {
        type: value === raw ? TOKEN.IDENTIFIER : TOKEN.OPERATOR,
        value,
        start,
        end: index
    };
}

export function tokenizeExpression(source) {
    const input = String(source ?? '');
    const length = input.length;
    if (length > EXPRESSION_LIMITS.sourceLength) {
        syntax(`Expression is too long; use at most ${EXPRESSION_LIMITS.sourceLength} characters`, EXPRESSION_LIMITS.sourceLength, input);
    }

    const tokens = [];
    let index = 0;
    while (index < length) {
        const code = input.charCodeAt(index);
        if (isWhitespaceCode(code)) {
            index += 1;
            continue;
        }

        if (isDigitCode(code) || (code === CC_DOT && isDigitCode(input.charCodeAt(index + 1)))) {
            const token = readNumberToken(input, index);
            tokens.push(token);
            index = token.end;
            continue;
        }

        if (isIdentifierStartCode(code)) {
            const token = readIdentifierToken(input, index);
            tokens.push(token);
            index = token.end;
            continue;
        }

        const next = input.charCodeAt(index + 1);
        if ((code === CC_LT && next === CC_EQ) || (code === CC_GT && next === CC_EQ) ||
            (code === CC_EQ && next === CC_EQ) || (code === CC_BANG && next === CC_EQ) ||
            (code === CC_AMP && next === CC_AMP) || (code === CC_PIPE && next === CC_PIPE)) {
            tokens.push({ type: TOKEN.OPERATOR, value: input.slice(index, index + 2), start: index, end: index + 2 });
            index += 2;
            continue;
        }

        switch (code) {
            case CC_PLUS: case CC_MINUS: case CC_STAR: case CC_SLASH: case CC_CARET:
            case CC_BANG: case CC_LT: case CC_GT: case CC_QUESTION: case CC_COLON:
                tokens.push({ type: TOKEN.OPERATOR, value: input[index], start: index, end: index + 1 });
                index += 1;
                continue;
            case CC_LPAREN: case CC_RPAREN: case CC_COMMA:
                tokens.push({ type: TOKEN.PUNCTUATION, value: input[index], start: index, end: index + 1 });
                index += 1;
                continue;
            default:
                syntax(`Unexpected character "${input[index]}"`, index, input);
        }
    }

    tokens.push({ type: TOKEN.EOF, value: '', start: length, end: length });
    if (tokens.length - 1 > EXPRESSION_LIMITS.tokenCount) {
        syntax(`Expression has too many tokens; use at most ${EXPRESSION_LIMITS.tokenCount}`, length, input);
    }
    return tokens;
}

function span(startNode, endNode) {
    return { start: startNode?.start ?? 0, end: endNode?.end ?? startNode?.end ?? 0 };
}

class Parser {
    constructor(source) {
        this.source = String(source ?? '');
        this.tokens = tokenizeExpression(this.source);
        this.index = 0;
    }

    current() { return this.tokens[this.index]; }
    previous() { return this.tokens[this.index - 1] || this.tokens[0]; }

    advance() {
        const token = this.tokens[this.index];
        if (token.type !== TOKEN.EOF) this.index += 1;
        return token;
    }

    match(value) {
        if (this.tokens[this.index].value !== value) return false;
        this.advance();
        return true;
    }

    expect(value, message = `Expected "${value}"`) {
        if (!this.match(value)) syntax(message, this.tokens[this.index].start, this.source);
        return this.previous();
    }

    parse() {
        if (this.tokens[this.index].type === TOKEN.EOF) syntax('Expression cannot be empty', 0, this.source);
        const expression = this.parseConditional();
        const token = this.tokens[this.index];
        if (token.type !== TOKEN.EOF) syntax(`Unexpected token "${token.value}"`, token.start, this.source);
        return expression;
    }

    parseConditional() {
        const test = this.parseLogicalOr();
        if (!this.match('?')) return test;
        const consequent = this.parseConditional();
        this.expect(':', 'Expected ":" in conditional expression');
        const alternate = this.parseConditional();
        return { type: 'conditional', test, consequent, alternate, ...span(test, alternate) };
    }

    parseLogicalOr() {
        let expression = this.parseLogicalAnd();
        while (this.tokens[this.index].value === '||') {
            const operator = this.advance();
            const right = this.parseLogicalAnd();
            expression = { type: 'binary', op: operator.value, left: expression, right, ...span(expression, right) };
        }
        return expression;
    }

    parseLogicalAnd() {
        let expression = this.parseEquality();
        while (this.tokens[this.index].value === '&&') {
            const operator = this.advance();
            const right = this.parseEquality();
            expression = { type: 'binary', op: operator.value, left: expression, right, ...span(expression, right) };
        }
        return expression;
    }

    parseEquality() {
        let expression = this.parseComparison();
        let value = this.tokens[this.index].value;
        while (value === '==' || value === '!=') {
            const operator = this.advance();
            const right = this.parseComparison();
            expression = { type: 'binary', op: operator.value, left: expression, right, ...span(expression, right) };
            value = this.tokens[this.index].value;
        }
        return expression;
    }

    parseComparison() {
        let expression = this.parseAdditive();
        let value = this.tokens[this.index].value;
        while (value === '<' || value === '<=' || value === '>' || value === '>=') {
            const operator = this.advance();
            const right = this.parseAdditive();
            expression = { type: 'binary', op: operator.value, left: expression, right, ...span(expression, right) };
            value = this.tokens[this.index].value;
        }
        return expression;
    }

    parseAdditive() {
        let expression = this.parseMultiplicative();
        let value = this.tokens[this.index].value;
        while (value === '+' || value === '-') {
            const operator = this.advance();
            const right = this.parseMultiplicative();
            expression = { type: 'binary', op: operator.value, left: expression, right, ...span(expression, right) };
            value = this.tokens[this.index].value;
        }
        return expression;
    }

    parseMultiplicative() {
        let expression = this.parseUnary();
        while (true) {
            const token = this.tokens[this.index];
            if (token.value === '*' || token.value === '/') {
                const operator = this.advance();
                const right = this.parseUnary();
                expression = { type: 'binary', op: operator.value, left: expression, right, implicit: false, ...span(expression, right) };
                continue;
            }
            if (isImplicitStart(token)) {
                const right = this.parseUnary();
                expression = { type: 'binary', op: '*', left: expression, right, implicit: true, ...span(expression, right) };
                continue;
            }
            return expression;
        }
    }

    parseUnary() {
        const value = this.tokens[this.index].value;
        if (value === '+' || value === '-' || value === '!') {
            const operator = this.advance();
            const argument = this.parseUnary();
            return { type: 'unary', op: operator.value, argument, start: operator.start, end: argument.end };
        }
        return this.parsePower();
    }

    parsePower() {
        let expression = this.parsePostfix();
        if (this.match('^')) {
            const right = this.parseUnary();
            expression = { type: 'binary', op: '^', left: expression, right, ...span(expression, right) };
        }
        return expression;
    }

    parsePostfix() {
        let expression = this.parsePrimary();
        while (this.match('!')) {
            expression = { type: 'postfix', op: '!', argument: expression, start: expression.start, end: this.previous().end };
        }
        return expression;
    }

    parsePrimary() {
        const token = this.tokens[this.index];
        if (token.type === TOKEN.NUMBER) {
            this.index += 1;
            return { type: 'literal', value: { re: token.value, im: 0 }, start: token.start, end: token.end };
        }
        if (token.type === TOKEN.IDENTIFIER) {
            this.index += 1;
            if (!this.match('(')) return { type: 'variable', name: token.value, start: token.start, end: token.end };
            const args = [];
            if (!this.match(')')) {
                do {
                    args.push(this.parseConditional());
                    if (args.length > EXPRESSION_LIMITS.functionArguments) {
                        syntax(`Functions may receive at most ${EXPRESSION_LIMITS.functionArguments} arguments`, this.tokens[this.index].start, this.source);
                    }
                } while (this.match(','));
                this.expect(')', 'Expected ")" after function arguments');
            }
            return { type: 'call', name: token.value, args, start: token.start, end: this.previous().end };
        }
        if (this.match('(')) {
            const opening = this.previous();
            const expression = this.parseConditional();
            const closing = this.expect(')', 'Expected ")" after expression');
            return { type: 'group', expression, start: opening.start, end: closing.end };
        }
        syntax(`Expected a value, found "${token.value || 'end of expression'}"`, token.start, this.source);
    }
}

function pushChildren(stack, node, depth) {
    switch (node?.type) {
        case 'group':
            if (node.expression) stack.push({ node: node.expression, depth });
            break;
        case 'unary':
        case 'postfix':
            if (node.argument) stack.push({ node: node.argument, depth });
            break;
        case 'binary':
            if (node.right) stack.push({ node: node.right, depth });
            if (node.left) stack.push({ node: node.left, depth });
            break;
        case 'conditional':
            if (node.alternate) stack.push({ node: node.alternate, depth });
            if (node.consequent) stack.push({ node: node.consequent, depth });
            if (node.test) stack.push({ node: node.test, depth });
            break;
        case 'call': {
            const args = node.args || [];
            for (let index = args.length - 1; index >= 0; index--) stack.push({ node: args[index], depth });
            break;
        }
        default:
            break;
    }
}

function validateExpressionComplexity(ast, source) {
    const stack = [{ node: ast, depth: 1 }];
    let nodeCount = 0;
    while (stack.length) {
        const item = stack.pop();
        const node = item.node;
        nodeCount += 1;
        if (nodeCount > EXPRESSION_LIMITS.nodeCount) {
            syntax(`Expression is too complex; use at most ${EXPRESSION_LIMITS.nodeCount} operations and values`, node?.start || 0, source);
        }
        if (item.depth > EXPRESSION_LIMITS.depth) {
            syntax(`Expression nesting is too deep; use at most ${EXPRESSION_LIMITS.depth} levels`, node?.start || 0, source);
        }
        pushChildren(stack, node, item.depth + 1);
    }
}

export function parseExpression(source) {
    const input = String(source ?? '');
    const ast = new Parser(input).parse();
    validateExpressionComplexity(ast, input);
    return ast;
}

export function walkExpression(node, visitor) {
    if (!node || typeof visitor !== 'function') return;
    const stack = [node];
    while (stack.length) {
        const current = stack.pop();
        visitor(current);
        switch (current.type) {
            case 'group':
                if (current.expression) stack.push(current.expression);
                break;
            case 'unary':
            case 'postfix':
                if (current.argument) stack.push(current.argument);
                break;
            case 'binary':
                if (current.right) stack.push(current.right);
                if (current.left) stack.push(current.left);
                break;
            case 'conditional':
                if (current.alternate) stack.push(current.alternate);
                if (current.consequent) stack.push(current.consequent);
                if (current.test) stack.push(current.test);
                break;
            case 'call': {
                const args = current.args || [];
                for (let index = args.length - 1; index >= 0; index--) stack.push(args[index]);
                break;
            }
            default:
                break;
        }
    }
}

export function collectExpressionDependencies(ast) {
    const variables = new Set();
    const functions = new Set();
    const stack = ast ? [ast] : [];
    while (stack.length) {
        const node = stack.pop();
        switch (node.type) {
            case 'variable':
                variables.add(node.name);
                break;
            case 'call': {
                functions.add(node.name);
                const args = node.args || [];
                for (let index = args.length - 1; index >= 0; index--) stack.push(args[index]);
                break;
            }
            case 'group':
                if (node.expression) stack.push(node.expression);
                break;
            case 'unary':
            case 'postfix':
                if (node.argument) stack.push(node.argument);
                break;
            case 'binary':
                if (node.right) stack.push(node.right);
                if (node.left) stack.push(node.left);
                break;
            case 'conditional':
                if (node.alternate) stack.push(node.alternate);
                if (node.consequent) stack.push(node.consequent);
                if (node.test) stack.push(node.test);
                break;
            default:
                break;
        }
    }
    return { variables, functions };
}