#!/usr/bin/env python3
"""
PTY relay wrapper providing a real POSIX pseudo-terminal for a child process.

Usage:
    python3 ptyRelay.py <cols> <rows> -- <command> [args...]

Node side spawns this wrapper (spawn('python3', [...ptyRelay.py, cols, rows, '--', cmd, ...args])
via child_process with stdio ['pipe','pipe','pipe','pipe']). It connects:

  - our stdin  (fd 0, from Node)     -> pty master  (child input; pty line discipline does echo)
  - pty master (child output+echo)   -> our stdout  (fd 1, to Node)
  - fd 3 (control channel)           -> NDJSON messages:
        {"op":"resize","cols":C,"rows":R}
        {"op":"signal","sig":"SIGINT"}
        {"op":"kill"}

Exit status is propagated correctly: wait_status>>8 for normal exit, 128+signal for
signal termination. This fixes the `pty.spawn` exit-code==0 bug.

Unless otherwise noted, the process group of the child is given the controlling terminal
so signals (SIGINT/SIGTERM) and job control behave like a real terminal.
"""
import pty
import sys
import os
import select
import struct
import fcntl
import termios
import signal
import subprocess


def kill_tree(root):
    """SIGKILL every descendant of `root` (recursively), then the process group.

    The shell (root) may have background jobs running in their OWN process
    groups (zsh job control: `sleep 300 &`). A plain killpg(root) misses those,
    orphaning them once the shell dies. Walk /bin/ps to find the full descendant
    set so no process under this session survives.
    """
    try:
        out = subprocess.check_output(['/bin/ps', '-ax', '-o', 'pid=,ppid='], text=True, timeout=3)
    except Exception:
        out = ''
    children = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 2:
            try:
                children.setdefault(int(parts[1]), []).append(int(parts[0]))
            except ValueError:
                pass
    victims = []
    stack = [root]
    while stack:
        p = stack.pop()
        for c in children.get(p, ()):
            victims.append(c)
            stack.append(c)
    for p in reversed(victims):
        try:
            os.kill(p, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
    try:
        os.killpg(os.getpgid(root), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        try:
            os.kill(root, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass

def main():
    argv = sys.argv[1:]
    sep = argv.index('--') if '--' in argv else len(argv)
    if sep >= 2:
        cols = int(argv[0])
        rows = int(argv[1])
    else:
        cols, rows = 120, 30
    cmd = argv[sep + 1:] if '--' in argv else ['/bin/zsh']
    if not cmd:
        cmd = ['/bin/zsh']

    # Fork a pty. The child connects its stdio to the slave; we keep the master.
    pid, master = pty.fork()
    if pid == 0:
        os.execvp(cmd[0], cmd)
        os._exit(127)

    os.set_blocking(master, True)

    def resize(c, r):
        try:
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
        except OSError:
            pass

    # Initial window size
    resize(cols, rows)

    control = None
    try:
        os.set_blocking(3, False)
        control = 3
    except Exception:
        control = None

    master_closed = False

    while True:
        readers = [0]
        if not master_closed:
            readers.append(master)
        if control is not None:
            readers.append(control)

        try:
            r, _, _ = select.select(readers, [], [], 1.0)
        except InterruptedError:
            continue
        except ValueError:
            break

        # Relay child output -> Node
        if master in r and not master_closed:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                chunk = b''
            if not chunk:
                master_closed = True
                try:
                    os.close(master)
                except OSError:
                    pass
            else:
                off = 0
                while off < len(chunk):
                    try:
                        off += os.write(1, chunk[off:])
                    except OSError:
                        break

        # Relay Node input -> pty (line discipline echoes to child)
        if 0 in r:
            try:
                data = os.read(0, 65536)
            except OSError:
                data = b''
            if data:
                off = 0
                while off < len(data):
                    try:
                        off += os.write(master, data[off:])
                    except OSError:
                        break
            else:
                # stdin EOF from Node -> send EOF to child
                try:
                    os.write(master, b'\x04')
                except OSError:
                    pass

        # Process control messages
        if control is not None and control in r:
            try:
                data = os.read(control, 65536)
            except OSError:
                data = b''
            if not data:
                control = None
            else:
                import json
                for line in data.split(b'\n'):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        msg = json.loads(line)
                    except Exception:
                        continue
                    op = msg.get('op')
                    try:
                        if op == 'resize':
                            resize(msg.get('cols', cols), msg.get('rows', rows))
                        elif op == 'signal':
                            sig_map = {'SIGINT': signal.SIGINT, 'SIGTERM': signal.SIGTERM,
                                       'SIGHUP': signal.SIGHUP, 'SIGQUIT': signal.SIGQUIT}
                            s = sig_map.get(msg.get('sig', ''))
                            if s:
                                # Signal the child's foreground process group so interactive
                                # programs and shells receive the interrupt like a real tty.
                                try:
                                    os.killpg(os.getpgid(pid), s)
                                except ProcessLookupError:
                                    os.kill(pid, s)
                        elif op == 'kill':
                            kill_tree(pid)
                    except Exception:
                        pass

        if master_closed:
            # Child closed its pty; drain stdio briefly then collect status.
            # Kill any remaining descendants (e.g. background jobs in their own
            # process groups) so nothing outlives the session.
            try:
                kill_tree(pid)
            except Exception:
                pass
            break

    # Collect final status
    status = 0
    try:
        _, status = os.waitpid(pid, 0)
    except Exception:
        try:
            _, status = os.waitpid(pid, os.WNOHANG)
        except Exception:
            status = 0

    if os.WIFEXITED(status):
        code = os.WEXITSTATUS(status)
    elif os.WIFSIGNALED(status):
        code = 128 + os.WTERMSIG(status)
    else:
        code = 0 if status == 0 else 1

    try:
        os.close(master)
    except OSError:
        pass
    sys.exit(code)

if __name__ == '__main__':
    main()
