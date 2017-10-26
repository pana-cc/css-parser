export interface Stylesheet {
    rules: Rule[];
}
export type Rule = QualifiedRule | AtRule;

export interface AtRule {
    type: "at-rule";
    name: string;
    prelude: InputToken[];
    block: SimpleBlock;
}
export interface QualifiedRule {
    type: "qualified-rule";
    prelude: InputToken[];
    block: SimpleBlock;
}

const whitespaceRegEx = /[\s\t\n\r\f]*/gym;

const singleQuoteStringRegEx = /'((?:[^\n\r\f\']|\\(?:\$|\n|[0-9a-fA-F]{1,6}\s?))*)(:?'|$)/gym; // Besides $n, parse escape 
const doubleQuoteStringRegEx = /"((?:[^\n\r\f\"]|\\(?:\$|\n|[0-9a-fA-F]{1,6}\s?))*)(:?"|$)/gym; // Besides $n, parse escape 
const commentRegEx = /(\/\*(?:[^\*]|\*[^\/])*\*\/)/gym;
const numberRegEx = /[\+\-]?(?:\d+\.\d+|\d+|\.\d+)(?:[eE][\+\-]?\d+)?/gym;
const nameRegEx = /-?(?:(?:[a-zA-Z_]|[^\x00-\x7F]|\\(?:\$|\n|[0-9a-fA-F]{1,6}\s?))(?:[a-zA-Z_0-9\-]*|\\(?:\$|\n|[0-9a-fA-F]{1,6}\s?))*)/gym;
const nonQuoteURLRegEx = /(:?[^\)\s\t\n\r\f\'\"\(]|\\(?:\$|\n|[0-9a-fA-F]{1,6}\s?))*/gym; // TODO: non-printable code points omitted
type InputToken = "(" | ")" | "{" | "}" | "[" | "]" | ":" | ";" | "," | " " | "^=" | "|=" | "$=" | "*=" | "~=" | "<!--" | "-->" | undefined /* <EOF-token> */ | InputTokenObject | FunctionInputToken | FunctionToken | SimpleBlock | AtKeywordToken;

export const enum TokenType {
    /**
     * <string-token>
     */
    string = "<string-token>",
    /**
     * <delim-token>
     */
    delim = "<delim-token>",
    /**
     * <number-token>
     */
    number = "<number-token>",
    /**
     * <percentage-token>
     */
    percentage = "<percentage-token>",
    /**
     * <dimension-token>
     */
    dimension = "<dimension-token>",
    /**
     * <ident-token>
     */
    ident = "<ident-token>",
    /**
     * <url-token>
     */
    url = "<url-token>",
    /**
     * <function-token>
     * This is a token indicating a function's leading: <ident-token>(
     */
    functionToken = "<function-token>",
    /**
     * <simple-block>
     */
    simpleBlock = "<simple-block>",
    /**
     * <comment-token>
     */
    comment = "<comment-token>",
    /**
     * <at-keyword-token>
     */
    atKeyword = "<at-keyword-token>",
    /**
     * <hash-token>
     */
    hash = "<hash-token>",
    /**
     * <function>
     * This is a complete consumed function: <function-token>([<component-value> [, <component-value>]*])")"
     */
    function = "<function>",
}

interface InputTokenObject {
    type: TokenType;
    text: string;
}

/**
 * This is a "<ident>(" token.
 */
interface FunctionInputToken extends InputTokenObject {
    name: string;
}

/**
 * This is a completely parsed function like "<ident>([component [, component]*])".
 */
interface FunctionToken extends FunctionInputToken {
    components: any[];
}

interface SimpleBlock extends InputTokenObject {
    associatedToken: InputToken;
    values: InputToken[];
}

interface AtKeywordToken extends InputTokenObject {}

/**
 * CSS parser following relatively close:
 * CSS Syntax Module Level 3
 * https://www.w3.org/TR/css-syntax-3/
 */
export class CSS3Parser {
    private nextInputCodePointIndex = 0;
    private reconsumedInputToken: InputToken;
    private topLevelFlag: boolean;

    constructor(private text: string) {}

    /**
     * For testing purposes.
     * This method allows us to run and assert the proper working of the tokenizer.
     */
    tokenize(): InputToken[] {
        let tokens: InputToken[] = [];
        let inputToken: InputToken;
        while(inputToken = this.consumeAToken()) {
            tokens.push(inputToken);
        }
        return tokens;
    }

    /**
     * 4.3.1. Consume a token
     * https://www.w3.org/TR/css-syntax-3/#consume-a-token
     */
    private consumeAToken(): InputToken {
        if (this.reconsumedInputToken) {
            let result = this.reconsumedInputToken;
            this.reconsumedInputToken = null;
            return result;
        }
        const char = this.text[this.nextInputCodePointIndex];
        switch(char) {
            case "\"": return this.consumeAStringToken();
            case "'": return this.consumeAStringToken();
            case "(":
            case ")":
            case ",":
            case ":":
            case ";":
            case "[":
            case "]":
            case "{":
            case "}":
                this.nextInputCodePointIndex++;
                return <any>char;
            case "#": return this.consumeAHashToken() || this.consumeADelimToken();
            case " ":
            case "\t":
            case "\n":
            case "\r":
            case "\f":
                return this.consumeAWhitespace();
            case "@": return this.consumeAtKeyword() || this.consumeADelimToken();
            // TODO: Only if this is valid escape, otherwise it is a parse error
            case "\\": return this.consumeAnIdentLikeToken() || this.consumeADelimToken();
            case "0":
            case "1":
            case "2":
            case "3":
            case "4":
            case "5":
            case "6":
            case "7":
            case "8":
            case "9":
                return this.consumeANumericToken();
            case "u":
            case "U":
                if (this.text[this.nextInputCodePointIndex + 1] === "+") {
                    const thirdChar = this.text[this.nextInputCodePointIndex + 2];
                    if (thirdChar >= '0' && thirdChar <= '9' || thirdChar === "?") {
                        // TODO: Handle unicode stuff such as U+002B
                        throw new Error("Unicode tokens not supported!");
                    }
                }
                return this.consumeAnIdentLikeToken() || this.consumeADelimToken();
            case "$":
            case "*":
            case "^":
            case "|":
            case "~":
                return this.consumeAMatchToken() || this.consumeADelimToken();
            case "-": return this.consumeANumericToken() || this.consumeAnIdentLikeToken() || this.consumeCDC() || this.consumeADelimToken();
            case "+":
            case ".":
                return this.consumeANumericToken() || this.consumeADelimToken();
            case "/": return this.consumeAComment() || this.consumeADelimToken();
            case "<": return this.consumeCDO() || this.consumeADelimToken();
            case undefined: return undefined;
            default: return this.consumeAnIdentLikeToken() || this.consumeADelimToken();
        }
    }

    private consumeADelimToken(): InputToken {
        return { type: TokenType.delim, text: this.text[this.nextInputCodePointIndex++] };
    }

    private consumeAWhitespace(): InputToken {
        whitespaceRegEx.lastIndex = this.nextInputCodePointIndex;
        const result = whitespaceRegEx.exec(this.text);
        this.nextInputCodePointIndex = whitespaceRegEx.lastIndex;
        return " ";
    }

    private consumeAHashToken(): InputTokenObject {
        this.nextInputCodePointIndex++;
        let hashName = this.consumeAName();
        if (hashName) {
            return { type: TokenType.hash, text: "#" + hashName.text };
        }
        this.nextInputCodePointIndex--;
        return null;
    }

    private consumeCDO(): "<!--" | null {
        if (this.text.substr(this.nextInputCodePointIndex, 4) === "<!--") {
            this.nextInputCodePointIndex += 4;
            return "<!--";
        }
        return null;
    }

    private consumeCDC(): "-->" | null {
        if (this.text.substr(this.nextInputCodePointIndex, 3) === "-->") {
            this.nextInputCodePointIndex += 3;
            return "-->";
        }
        return null;
    }

    private consumeAMatchToken(): "*=" | "$=" | "|=" | "~=" | "^=" | null {
        if (this.text[this.nextInputCodePointIndex + 1] === "=") {
            const token = this.text.substr(this.nextInputCodePointIndex, 2);
            this.nextInputCodePointIndex += 2
            return <"*=" | "$=" | "|=" | "~=" | "^=">token;
        }
        return null;
    }

    /**
     * 4.3.2. Consume a numeric token
     * https://www.w3.org/TR/css-syntax-3/#consume-a-numeric-token
     */
    private consumeANumericToken(): InputToken {
        numberRegEx.lastIndex = this.nextInputCodePointIndex;
        const result = numberRegEx.exec(this.text);
        if (!result) {
            return null;
        }
        this.nextInputCodePointIndex = numberRegEx.lastIndex;
        if (this.text[this.nextInputCodePointIndex] === "%") {
            return { type: TokenType.percentage, text: result[0] }; // TODO: Push the actual number and unit here...
        }

        const name = this.consumeAName();
        if (name) {
            return { type: TokenType.dimension, text: result[0] + name.text };
        }

        return { type: TokenType.number, text: result[0] };
    }

    /**
     * 4.3.3. Consume an ident-like token
     * https://www.w3.org/TR/css-syntax-3/#consume-an-ident-like-token
     */
    private consumeAnIdentLikeToken(): InputToken {
        const name = this.consumeAName();
        if (!name) {
            return null;
        }
        if (this.text[this.nextInputCodePointIndex] === "(") {
            this.nextInputCodePointIndex++;
            if (name.text.toLowerCase() === "url") {
                return this.consumeAURLToken();
            }
            return <FunctionInputToken>{ type: TokenType.functionToken, name: name.text, text: name.text + "(" };
        }
        return name;
    }

    /**
     * 4.3.4. Consume a string token
     * https://www.w3.org/TR/css-syntax-3/#consume-a-string-token
     */
    private consumeAStringToken(): InputTokenObject {
        const char = this.text[this.nextInputCodePointIndex];
        let result: RegExpExecArray;
        if (char === "'") {
            singleQuoteStringRegEx.lastIndex = this.nextInputCodePointIndex;
            result = singleQuoteStringRegEx.exec(this.text);
            if (!result) {
                return null;
            }
            this.nextInputCodePointIndex = singleQuoteStringRegEx.lastIndex;
        } else if (char === "\"") {
            doubleQuoteStringRegEx.lastIndex = this.nextInputCodePointIndex;
            result = doubleQuoteStringRegEx.exec(this.text);
            if (!result) {
                return null;
            }
            this.nextInputCodePointIndex = doubleQuoteStringRegEx.lastIndex;
        }

        // TODO: Handle bad-string.
        // TODO: Perform string escaping.
        return { type: TokenType.string, text: result[0] };
    }

    /**
     * 4.3.5. Consume a url token
     * https://www.w3.org/TR/css-syntax-3/#consume-a-url-token
     */
    private consumeAURLToken(): InputToken {
        const start = this.nextInputCodePointIndex - 3 /* url */ - 1 /* ( */;
        const urlToken: InputToken = { type: TokenType.url, text: "" };
        this.consumeAWhitespace();
        if (this.nextInputCodePointIndex >= this.text.length) {
            return urlToken;
        }
        const nextInputCodePoint = this.text[this.nextInputCodePointIndex];
        if (nextInputCodePoint === "\"" || nextInputCodePoint === "'") {
            const stringToken = this.consumeAStringToken();
            // TODO: Handle bad-string.
            // TODO: Set value instead.
            urlToken.text = stringToken.text;
            this.consumeAWhitespace();
            if (this.text[this.nextInputCodePointIndex] === ")" || this.nextInputCodePointIndex >= this.text.length) {
                this.nextInputCodePointIndex++;
                const end = this.nextInputCodePointIndex;
                urlToken.text = this.text.substring(start, end);
                return urlToken;
            } else {
                // TODO: Handle bad-url.
                return null;
            }
        }

        while(this.nextInputCodePointIndex < this.text.length) {
            const char = this.text[this.nextInputCodePointIndex++];
            switch(char) {
                case ")": return urlToken;
                case " ":
                case "\t":
                case "\n":
                case "\r":
                case "\f":
                    this.consumeAWhitespace();
                    if (this.text[this.nextInputCodePointIndex] === ")") {
                        this.nextInputCodePointIndex++;
                        return urlToken;
                    } else {
                        // TODO: Bar url! Consume remnants.
                        return null;
                    }
                case "\"":
                case "\'":
                    // TODO: Parse error! Bar url! Consume remnants.
                    return null;
                case "\\":
                    // TODO: Escape!
                    throw new Error("Escaping not yet supported!");
                default:
                    // TODO: Non-printable chars - error.
                    urlToken.text += char;
            }
        }
        return urlToken;
    }

    /**
     * 4.3.11. Consume a name
     * https://www.w3.org/TR/css-syntax-3/#consume-a-name
     */
    private consumeAName(): InputTokenObject {
        nameRegEx.lastIndex = this.nextInputCodePointIndex;
        const result = nameRegEx.exec(this.text);
        if (!result) {
            return null;
        }
        this.nextInputCodePointIndex = nameRegEx.lastIndex;
        // TODO: Perform string escaping.
        return { type: TokenType.ident, text: result[0] };
    }

    private consumeAtKeyword(): InputTokenObject {
        this.nextInputCodePointIndex++;
        let name = this.consumeAName();
        if (name) {
            return { type: TokenType.atKeyword, text: name.text };
        }
        this.nextInputCodePointIndex--;
        return null;
    }

    private consumeAComment(): InputToken {
        if (this.text[this.nextInputCodePointIndex + 1] === "*") {
            commentRegEx.lastIndex = this.nextInputCodePointIndex;
            const result = commentRegEx.exec(this.text);
            if (!result) {
                return null; // TODO: Handle <bad-comment>
            }
            this.nextInputCodePointIndex = commentRegEx.lastIndex;
            // The CSS spec tokenizer does not emmit comment tokens
            return this.consumeAToken();
        }
        return null;
    }

    private reconsumeTheCurrentInputToken(currentInputToken: InputToken) {
        this.reconsumedInputToken = currentInputToken;
    }

    /**
     * 5.3.1. Parse a stylesheet
     * https://www.w3.org/TR/css-syntax-3/#parse-a-stylesheet
     */
    public parseAStylesheet(): Stylesheet {
        this.topLevelFlag = true;
        const stylesheet: Stylesheet = {
            rules: this.consumeAListOfRules()
        };
        return stylesheet;
    }

    /**
     * 5.4.1. Consume a list of rules
     * https://www.w3.org/TR/css-syntax-3/#consume-a-list-of-rules
     */
    public consumeAListOfRules(): Rule[] {
        const rules: Rule[] = [];
        let inputToken: InputToken;
        while(inputToken = this.consumeAToken()) {
            switch(inputToken) {
                case " ": continue;
                case "<!--":
                case "-->":
                    if (this.topLevelFlag) {
                        continue;
                    }
                    this.reconsumeTheCurrentInputToken(inputToken);
                    const atRule = this.consumeAnAtRule();
                    if (atRule) {
                        rules.push(atRule);
                    }
                    continue;
            }
            if ((<InputTokenObject>inputToken).type === TokenType.atKeyword) {
                this.reconsumeTheCurrentInputToken(inputToken);
                const atRule = this.consumeAnAtRule();
                if (atRule) {
                    rules.push(atRule);
                }
                continue;
            }
            this.reconsumeTheCurrentInputToken(inputToken);
            const qualifiedRule = this.consumeAQualifiedRule();
            if (qualifiedRule) {
                rules.push(qualifiedRule);
            }
        }
        return rules;
    }

    /**
     * 5.4.2. Consume an at-rule
     * https://www.w3.org/TR/css-syntax-3/#consume-an-at-rule
     */
    public consumeAnAtRule(): AtRule {
        let inputToken = this.consumeAToken();
        const atRule: AtRule = {
            type: "at-rule",
            name: (<AtKeywordToken>inputToken).text,
            prelude: [],
            block: undefined
        }
        while(inputToken = this.consumeAToken()) {
            if (inputToken === ";") {
                return atRule;
            } else if (inputToken === "{") {
                atRule.block = this.consumeASimpleBlock(inputToken);
                return atRule;
            } else if ((<InputTokenObject>inputToken).type === TokenType.simpleBlock && (<SimpleBlock>inputToken).associatedToken === "{") {
                atRule.block = <SimpleBlock>inputToken;
                return atRule;
            }
            this.reconsumeTheCurrentInputToken(inputToken);
            const component = this.consumeAComponentValue();
            if (component) {
                atRule.prelude.push(component);
            }
        }
        return atRule;
    }

    /**
     * 5.4.3. Consume a qualified rule
     * https://www.w3.org/TR/css-syntax-3/#consume-a-qualified-rule
     */
    public consumeAQualifiedRule(): QualifiedRule {
        const qualifiedRule: QualifiedRule = {
            type: "qualified-rule",
            prelude: [],
            block: undefined
        };
        let inputToken: InputToken;
        while(inputToken = this.consumeAToken()) {
            if (inputToken === "{") {
                let block = this.consumeASimpleBlock(inputToken);
                qualifiedRule.block = block;
                return qualifiedRule;
            } else if ((<InputTokenObject>inputToken).type === TokenType.simpleBlock) {
                const simpleBlock: SimpleBlock = <SimpleBlock>inputToken;
                if (simpleBlock.associatedToken === "{") {
                    qualifiedRule.block = simpleBlock;
                    return qualifiedRule;
                }
            }
            this.reconsumeTheCurrentInputToken(inputToken);
            const componentValue = this.consumeAComponentValue();
            if (componentValue) {
                qualifiedRule.prelude.push(componentValue);
            }
        }
        // TODO: This is a parse error, log parse errors!
        return null;
    }

    /**
     * 5.4.6. Consume a component value
     * https://www.w3.org/TR/css-syntax-3/#consume-a-component-value
     */
    private consumeAComponentValue(): InputToken {
        // const inputToken = this.consumeAToken();
        const inputToken = this.consumeAToken();
        switch(inputToken) {
            case "{":
            case "[":
            case "(":
                this.nextInputCodePointIndex++;
                return this.consumeASimpleBlock(inputToken);
        }
        if (typeof inputToken === "object" && inputToken.type === TokenType.functionToken) {
            return this.consumeAFunction((<FunctionInputToken>inputToken).name);
        }
        return inputToken;
    }

    /**
     * 5.4.7. Consume a simple block
     * https://www.w3.org/TR/css-syntax-3/#consume-a-simple-block
     */
    private consumeASimpleBlock(associatedToken: InputToken): SimpleBlock {
        const endianToken: "]" | "}" | ")" = {
            "[": "]",
            "{": "}",
            "(": ")"
        }[<any>associatedToken];
        const start = this.nextInputCodePointIndex - 1;
        const block: SimpleBlock = {
            type: TokenType.simpleBlock,
            text: undefined,
            associatedToken,
            values: []
        };
        let nextInputToken;
        while(nextInputToken = this.text[this.nextInputCodePointIndex]) {
            if (nextInputToken === endianToken) {
                this.nextInputCodePointIndex++;
                const end = this.nextInputCodePointIndex;
                block.text = this.text.substring(start, end);
                return block;
            }
            const value = this.consumeAComponentValue();
            if (value) {
                block.values.push(value);
            }
        }
        block.text = this.text.substring(start);
        return block;
    }

    /**
     * 5.4.8. Consume a function
     * https://www.w3.org/TR/css-syntax-3/#consume-a-function
     */
    private consumeAFunction(name: string): InputToken {
        const start = this.nextInputCodePointIndex;
        const funcToken: FunctionToken = { type: TokenType.function, name, text: undefined, components: [] };
        do {
            if (this.nextInputCodePointIndex >= this.text.length) {
                funcToken.text = name + "(" + this.text.substring(start);
                return funcToken;
            }
            const nextInputToken = this.text[this.nextInputCodePointIndex];
            switch(nextInputToken) {
                case ")":
                    this.nextInputCodePointIndex++;
                    const end = this.nextInputCodePointIndex;
                    funcToken.text = name + "(" + this.text.substring(start, end);
                    return funcToken;
                default:
                    const component = this.consumeAComponentValue();
                    if (component) {
                        funcToken.components.push(component);
                    }
                    // TODO: Else we won't advance
            }
        } while(true);
    }
}

/**
 * Consume a CSS3 parsed stylesheet and convert the rules and selectors to the
 * NativeScript internal JSON representation.
 */
export class CSSNativeScript {
    public parseStylesheet(stylesheet: Stylesheet): any {
        return {
            type: "stylesheet",
            stylesheet: {
                rules: this.parseRules(stylesheet.rules)
            }
        }
    }

    private parseRules(rules: Rule[]): any {
        return rules.map(rule => this.parseRule(rule));
    }

    private parseRule(rule: Rule): any {
        if (rule.type === "at-rule") {
            return this.parseAtRule(rule);
        } else if (rule.type === "qualified-rule") {
            return this.parseQualifiedRule(rule);
        }
    }

    private parseAtRule(rule: AtRule): any {
        if (rule.name === "import") {
            // TODO: We have used an "@improt { url('path somewhere'); }" at few places.
            return {
                import: rule.prelude.map(m => typeof m === "string" ? m : m.text).join("").trim(),
                type: "import"
            }
        }
        return;
    }

    private parseQualifiedRule(rule: QualifiedRule): any {
        return {
            type: "rule",
            selectors: this.preludeToSelectorsStringArray(rule.prelude),
            declarations: this.ruleBlockToDeclarations(rule.block.values)
        }
    }

    private ruleBlockToDeclarations(declarationsInputTokens: InputToken[]): { type: "declaration", property: string, value: string }[] {
        // return <any>declarationsInputTokens;
        const declarations: { type: "declaration", property: string, value: string }[] = [];

        let property = "";
        let value = "";
        let reading: "property" | "value" = "property";

        for (var i = 0; i < declarationsInputTokens.length; i++) {
            let inputToken = declarationsInputTokens[i];
            if (reading === "property") {
                if (inputToken === ":") {
                    reading = "value";
                } else if (typeof inputToken === "string") {
                    property += inputToken;
                } else {
                    property += inputToken.text;
                }
            } else {
                if (inputToken === ";") {
                    property = property.trim();
                    value = value.trim();
                    declarations.push({ type: "declaration", property, value });
                    property = "";
                    value = "";
                    reading = "property";
                } else if (typeof inputToken === "string") {
                    value += inputToken;
                } else {
                    value += inputToken.text;
                }
            }
        }
        property = property.trim();
        value = value.trim();
        if (property || value) {
            declarations.push({ type: "declaration", property, value });
        }
        return declarations;
    }

    private preludeToSelectorsStringArray(prelude: InputToken[]): string[] {
        let selectors = [];
        let selector = "";
        prelude.forEach(inputToken => {
            if (typeof inputToken === "string") {
                if (inputToken === ",") {
                    if (selector) {
                        selectors.push(selector.trim());
                    }
                    selector = "";
                } else {
                    selector += inputToken;
                }
            } else if (typeof inputToken === "object") {
                selector += inputToken.text;
            }
        });
        if (selector) {
            selectors.push(selector.trim());
        }
        return selectors;
    }
}