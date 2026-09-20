import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Java Wandbox payload — no prog.java for public classes', () => {
  it('produces Factorial.java codes with compiler-option-raw, not prog.java code', () => {
    // We intercept https.request to capture payload without network
    const wandbox = require('../server/services/execution/wandboxExecutor.cjs');
    const https = require('https');
    const originalRequest = https.request;
    let capturedPayload: any = null;

    const mockReq = {
      on: () => {},
      write: (data: string) => {
        capturedPayload = JSON.parse(data);
      },
      end: () => {},
    };
    const mockRes = {
      on: (event: string, cb: Function) => {
        if (event === 'data') cb(JSON.stringify({ status: '0', program_message: '', compiler_message: '', program_error: '' }));
        if (event === 'end') cb();
      },
    };
    https.request = ((url: any, opts: any, cb: any) => {
      cb(mockRes);
      return mockReq;
    }) as any;

    const code = `public class Factorial {
      public static void main(String[] args) {
          int n = 5;
          int factorial = 1;
          for (int i = 1; i <= n; i++) factorial *= i;
          System.out.println("Factorial of " + n + " is " + factorial);
      }
    }`;
    // Trigger compileViaWandbox with Factorial.java filename
    return wandbox.compileViaWandbox({ language: 'java', code, stdin: '', filename: 'Factorial.java' }).then(() => {
      expect(capturedPayload).not.toBeNull();
      expect(capturedPayload.compiler).toBe('openjdk-jdk-22+36');
      // Must NOT be 'prog.java' in code field containing public class
      // Our payload uses codes[] with Factorial.java and empty code
      expect(capturedPayload.code).toBe('');
      expect(capturedPayload.codes).toBeDefined();
      expect(capturedPayload.codes[0].file).toBe('Factorial.java');
      expect(capturedPayload.codes[0].code).toContain('public class Factorial');
      expect(capturedPayload['compiler-option-raw']).toBe('Factorial.java');
      // Must never be prog.java
      expect(capturedPayload.codes[0].file).not.toBe('prog.java');
      expect(capturedPayload['compiler-option-raw']).not.toBe('prog.java');
      https.request = originalRequest;
    });
  });

  it('HelloWorld via test.java resolves to HelloWorld.java via public type', () => {
    const wandbox = require('../server/services/execution/wandboxExecutor.cjs');
    const https = require('https');
    const originalRequest = https.request;
    let capturedPayload: any = null;
    const mockReq = {
      on: () => {},
      write: (data: string) => { capturedPayload = JSON.parse(data); },
      end: () => {},
    };
    const mockRes = {
      on: (event: string, cb: Function) => {
        if (event === 'data') cb(JSON.stringify({ status: '0', program_message: '', compiler_message: '', program_error: '' }));
        if (event === 'end') cb();
      },
    };
    https.request = ((url: any, opts: any, cb: any) => { cb(mockRes); return mockReq; }) as any;

    const code = `public class HelloWorld { public static void main(String[] args){ System.out.println("Hello World"); } }`;
    return wandbox.compileViaWandbox({ language: 'java', code, stdin: '', filename: 'test.java' }).then(() => {
      expect(capturedPayload.codes[0].file).toBe('HelloWorld.java');
      expect(capturedPayload['compiler-option-raw']).toBe('HelloWorld.java');
      https.request = originalRequest;
    });
  });

  it('python remains single code field, no codes', () => {
    const wandbox = require('../server/services/execution/wandboxExecutor.cjs');
    const https = require('https');
    const originalRequest = https.request;
    let capturedPayload: any = null;
    const mockReq = {
      on: () => {},
      write: (data: string) => { capturedPayload = JSON.parse(data); },
      end: () => {},
    };
    const mockRes = {
      on: (event: string, cb: Function) => {
        if (event === 'data') cb(JSON.stringify({ status: '0', program_message: 'hi', compiler_message: '', program_error: '' }));
        if (event === 'end') cb();
      },
    };
    https.request = ((url: any, opts: any, cb: any) => { cb(mockRes); return mockReq; }) as any;
    return wandbox.compileViaWandbox({ language: 'python', code: 'print("hi")', stdin: '', filename: 'main.py' }).then(() => {
      expect(capturedPayload.code).toBe('print("hi")');
      expect(capturedPayload.codes).toBeUndefined();
      https.request = originalRequest;
    });
  });
});
