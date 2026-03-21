import requests
import json
import time

URL = "http://localhost:3001/execute"

tests = [
    {"lang": "python", "code": "print('hello from python')"},
    {"lang": "javascript", "code": "console.log('hello from javascript');"},
    {"lang": "java", "code": "public class TestMe {\n    public static void main(String[] args) {\n        System.out.println(\"hello from java\");\n    }\n}"},
    {"lang": "c", "code": "#include <stdio.h>\nint main() { printf(\"hello from c\\n\"); return 0; }"},
    {"lang": "cpp", "code": "#include <iostream>\nint main() { std::cout << \"hello from cpp\" << std::endl; return 0; }"},
    {"lang": "ruby", "code": "puts 'hello from ruby'"},
    {"lang": "php", "code": "<?php echo \"hello from php\\n\"; ?>"},
    {"lang": "perl", "code": "print \"hello from perl\\n\";"},
    {"lang": "bash", "code": "echo 'hello from bash'"}
]

for t in tests:
    payload = {
        "language": t["lang"],
        "files": [{"name": "main", "content": t["code"]}]
    }
    try:
        r = requests.post(URL, json=payload, headers={'Content-Type': 'application/json'})
        data = r.json()
        out = data.get("run", {}).get("stdout", "").strip()
        err = data.get("run", {}).get("stderr", "").strip()
        if "hello from" in out.lower() or "hello from" in err.lower():
            print(f"[OK] {t['lang']}: {out}")
        else:
            print(f"[FAIL] {t['lang']}: out='{out}' err='{err}'")
    except Exception as e:
        print(f"[ERROR] {t['lang']}: {str(e)}")
    time.sleep(0.5)
