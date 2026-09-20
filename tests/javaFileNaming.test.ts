import { describe, it, expect } from 'vitest';

const {
  resolveFileName,
  resolveJavaFileName,
  sanitizeJavaFilename,
  extractPublicTopLevelTypes,
  isValidJavaIdentifier,
} = require('../server/services/execution/fileNaming.cjs');

describe('Java File Naming — regression for prog.java bug', () => {
  it('A: Factorial.java + public class Factorial => Factorial.java', () => {
    const code = `public class Factorial {
      public static void main(String[] args) {
          int n = 5;
          int factorial = 1;
          for (int i = 1; i <= n; i++) factorial *= i;
          System.out.println("Factorial of " + n + " is " + factorial);
      }
    }`;
    expect(resolveJavaFileName(code, 'Factorial.java')).toBe('Factorial.java');
    expect(resolveFileName('java', code, '.java', 'Factorial.java')).toBe('Factorial.java');
    // Must NOT be prog.java
    expect(resolveJavaFileName(code, 'Factorial.java')).not.toBe('prog.java');
    expect(resolveJavaFileName(code, 'Factorial.java')).not.toBe('main.java');
  });

  it('B: test.java + public class HelloWorld => HelloWorld.java (class-name resolution)', () => {
    const code = `public class HelloWorld { public static void main(String[] args){ System.out.println("Hello World"); } }`;
    expect(resolveJavaFileName(code, 'test.java')).toBe('HelloWorld.java');
    expect(resolveFileName('java', code, '.java', 'test.java')).toBe('HelloWorld.java');
    // Editor filename ignored when public type exists
    expect(resolveJavaFileName(code, 'test.java')).not.toBe('test.java');
  });

  it('C: Main.java + public class Main => Main.java', () => {
    const code = `public class Main { public static void main(String[] args){ System.out.println("OK"); } }`;
    expect(resolveJavaFileName(code, 'Main.java')).toBe('Main.java');
  });

  it('D: No public class => sanitized editor filename', () => {
    const code = `class Test { public static void main(String[] args){ System.out.println("No public class"); } }`;
    expect(resolveJavaFileName(code, 'Test.java')).toBe('Test.java');
    expect(resolveFileName('java', code, '.java', 'Test.java')).toBe('Test.java');
  });

  it('E: Public final class Example => Example.java', () => {
    const code = `public final class Example { public static void main(String[] args){ System.out.println("final"); } }`;
    expect(resolveJavaFileName(code, 'Example.java')).toBe('Example.java');
    const extracted = extractPublicTopLevelTypes(code);
    expect(extracted).toEqual(['Example']);
  });

  it('F: public abstract class', () => {
    const code = `public abstract class AbstractFoo { }`;
    expect(resolveJavaFileName(code, 'Wrong.java')).toBe('AbstractFoo.java');
  });

  it('G: public interface', () => {
    const code = `public interface Foo { void bar(); }`;
    expect(resolveJavaFileName(code, 'Bar.java')).toBe('Foo.java');
  });

  it('H: public enum', () => {
    const code = `public enum Color { RED, GREEN }`;
    expect(resolveJavaFileName(code, 'Wrong.java')).toBe('Color.java');
  });

  it('I: public record', () => {
    const code = `public record Point(int x, int y) {}`;
    expect(resolveJavaFileName(code, 'Other.java')).toBe('Point.java');
  });

  it('J: public @interface', () => {
    const code = `public @interface MyAnnotation { String value(); }`;
    expect(resolveJavaFileName(code, 'Other.java')).toBe('MyAnnotation.java');
  });

  it('K: sanitization - traversal not allowed', () => {
    expect(sanitizeJavaFilename('../../etc/passwd')).toBe('passwd.java');
    // The filename should never contain slashes
    const sanitized = sanitizeJavaFilename('../../etc/passwd');
    expect(sanitized).not.toContain('/');
    expect(sanitized).not.toContain('..');
    // resolve should prefer public type over traversal filename
    const code = `public class Safe { public static void main(String[] args){} }`;
    expect(resolveJavaFileName(code, '../../etc/passwd')).toBe('Safe.java');
    // No public type + traversal filename sanitizes to passwd.java, not a path
    const code2 = `class Safe {}`;
    expect(resolveJavaFileName(code2, '../../etc/passwd')).toBe('passwd.java');
    expect(resolveJavaFileName(code2, '../../etc/passwd')).not.toContain('/');
  });

  it('L: invalid identifier filename falls back to Main.java', () => {
    const code = `class Test {}`;
    expect(resolveJavaFileName(code, '123invalid.java')).toBe('Main.java');
    expect(sanitizeJavaFilename('123invalid.java')).toBeNull();
  });

  it('M: multiple public types => fallback to sanitized editor filename', () => {
    const code = `public class A {} public class B {}`;
    expect(resolveJavaFileName(code, 'MyFile.java')).toBe('MyFile.java');
  });

  it('N: zero public types + no filename => Main.java generic', () => {
    const code = `class Test {}`;
    expect(resolveJavaFileName(code, null)).toBe('Main.java');
    expect(resolveJavaFileName(code, '')).toBe('Main.java');
  });

  it('O: isValidJavaIdentifier', () => {
    expect(isValidJavaIdentifier('Factorial')).toBe(true);
    expect(isValidJavaIdentifier('_Safe123')).toBe(true);
    expect(isValidJavaIdentifier('123Bad')).toBe(false);
    expect(isValidJavaIdentifier('')).toBe(false);
  });

  it('P: Python and JS unaffected by Java logic', () => {
    expect(resolveFileName('python', 'print("hi")', '.py', 'test.py')).toBe('main.py');
    expect(resolveFileName('javascript', 'console.log("hi")', '.js', 'app.js')).toBe('main.js');
  });

  it('Q: Never returns prog.java for Java', () => {
    const cases = [
      ['public class Factorial {}', 'Factorial.java'],
      ['public class HelloWorld {}', 'test.java'],
      ['class Foo {}', 'Foo.java'],
      ['public final class Bar {}', 'Bar.java'],
    ] as const;
    for (const [code, filename] of cases) {
      const result = resolveJavaFileName(code, filename);
      expect(result).not.toBe('prog.java');
    }
  });
});
