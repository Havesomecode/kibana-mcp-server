"""Run the bundled native check both without and with a controlling TTY.

Usage: python3 verify-macos-keychain-tty.py /absolute/node ./native.mjs
Only bounded PASS/FAIL output is emitted; captured native output stays private.
"""
import os
import pty
import select
import signal
import subprocess
import sys
import time


def probe_getpass():
    # Exercise the old writer's libc boundary without opening any keychain.
    payload = b'{"username":"fictitious","password":"test-only"}\n'
    code = (
        "import ctypes; c=ctypes.CDLL(None); c.getpass.restype=ctypes.c_char_p; "
        "value=c.getpass(b'password data for new item: '); "
        "print('RESULT_LENGTH='+str(len(value)), flush=True)"
    )
    result = subprocess.run(
        [sys.executable, "-c", code], input=payload,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        start_new_session=True, timeout=5,
    )
    assert result.returncode == 0
    assert result.stdout.strip() == f"RESULT_LENGTH={len(payload)-1}".encode()
    reader, writer = os.pipe()
    os.write(writer, payload)
    os.close(writer)
    pid, master = pty.fork()
    if pid == 0:
        os.dup2(reader, 0)
        os.close(reader)
        os.execv(sys.executable, [sys.executable, "-c", code])
    os.close(reader)
    output = bytearray()
    deadline = time.monotonic() + 2
    try:
        while time.monotonic() < deadline:
            ready, _, _ = select.select([master], [], [], 0.1)
            if ready:
                output.extend(os.read(master, 4096))
        assert b"password data for new item:" in output
        assert b"RESULT_LENGTH=" not in output
    finally:
        os.killpg(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
        os.close(master)
    print("PASS old getpass boundary: stdin read without TTY; controlling TTY ignores pipe and blocks; child reaped; no keychain accessed")


if sys.argv[1:] == ["--probe-getpass"]:
    probe_getpass()
    sys.exit(0)


def report(mode, code, output):
    prompts = (b"password data for new item", b"retype password for new item")
    prompted = any(prompt in output for prompt in prompts)
    for line in output.decode(errors="replace").splitlines():
        if line.startswith(("PASS ", "FAIL ")):
            print(mode + ": " + line, flush=True)
    print(f"{mode}: exit={code}; password_prompt={prompted}", flush=True)
    return code == 0 and not prompted


node, script = sys.argv[1:3]
result = subprocess.run(
    [node, script, "--timeout"], stdin=subprocess.DEVNULL,
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    start_new_session=True, timeout=100,
)
ok = report("no TTY", result.returncode, result.stdout)

pid, master = pty.fork()
if pid == 0:
    # Prove a controlling terminal exists while fd 0 is still a pipe.
    tty = os.open("/dev/tty", os.O_RDWR)
    os.close(tty)
    reader, writer = os.pipe()
    os.close(writer)
    os.dup2(reader, 0)
    os.close(reader)
    os.execv(node, [node, script])

output = bytearray()
deadline = time.monotonic() + 100
try:
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], 0.2)
        if not ready:
            continue
        try:
            chunk = os.read(master, 65536)
        except OSError:
            break
        if not chunk:
            break
        output.extend(chunk)
    else:
        os.killpg(pid, signal.SIGKILL)
finally:
    os.close(master)
_, status = os.waitpid(pid, 0)
ok = report("controlling TTY + piped stdin", os.waitstatus_to_exitcode(status), output) and ok
sys.exit(0 if ok else 1)
