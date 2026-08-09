// Minimal Windows service host for AION Elevated Operator Broker.
// Compiles with .NET Framework csc.exe. Launches Node service-main from install root.
// Does not load policy/binaries from C:\AION-HQ after install.

using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Threading;

namespace Aion.ElevatedOperatorBroker
{
    public class BrokerService : ServiceBase
    {
        private Process _child;
        private readonly string _installRoot;
        private readonly string _nodeExe;
        private readonly string _entry;
        private readonly string _logPath;

        public BrokerService()
        {
            ServiceName = "AionElevatedBroker";
            CanStop = true;
            CanShutdown = true;
            AutoLog = true;
            _installRoot = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            // bin\ -> install root
            if (Path.GetFileName(_installRoot).Equals("bin", StringComparison.OrdinalIgnoreCase))
            {
                _installRoot = Directory.GetParent(_installRoot).FullName;
            }
            _nodeExe = Environment.GetEnvironmentVariable("AION_NODE_EXE");
            if (string.IsNullOrEmpty(_nodeExe))
            {
                // Prefer pinned runtime under install root (service SID can execute RX install root)
                var candidates = new string[] {
                    Path.Combine(_installRoot, "runtime", "node.exe"),
                    @"C:\Program Files\nodejs\node.exe",
                    @"C:\Users\User\dev\tools\nodejs\node.exe"
                };
                foreach (var c in candidates)
                {
                    if (File.Exists(c)) { _nodeExe = c; break; }
                }
            }
            _entry = Path.Combine(_installRoot, "lib", "service-main.mjs");
            _logPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "AION", "ElevatedOperatorBroker", "public", "audit", "service-host.log");
        }

        protected override void OnStart(string[] args)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(_logPath));
                Log("OnStart installRoot=" + _installRoot);
                if (string.IsNullOrEmpty(_nodeExe) || !File.Exists(_nodeExe))
                    throw new InvalidOperationException("Node executable not found for broker service");
                if (!File.Exists(_entry))
                    throw new InvalidOperationException("service-main.mjs missing under install root");

                var psi = new ProcessStartInfo
                {
                    FileName = _nodeExe,
                    Arguments = "\"" + _entry + "\"",
                    WorkingDirectory = _installRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                psi.EnvironmentVariables["AION_REPOSITORY_ROOT"] = @"C:\AION-HQ";
                psi.EnvironmentVariables["AION_MACHINE_ROLE"] = "DESKTOP TARGET CANDIDATE / NON-PRIMARY";
                psi.EnvironmentVariables["AION_OWNER_UI_PORT"] = "17865";

                _child = new Process { StartInfo = psi, EnableRaisingEvents = true };
                _child.OutputDataReceived += (s, e) => { if (e.Data != null) Log("out " + e.Data); };
                _child.ErrorDataReceived += (s, e) => { if (e.Data != null) Log("err " + e.Data); };
                _child.Exited += (s, e) => Log("child exited code=" + _child.ExitCode);
                if (!_child.Start()) throw new InvalidOperationException("Failed to start node child");
                _child.BeginOutputReadLine();
                _child.BeginErrorReadLine();
                Log("child started pid=" + _child.Id);
            }
            catch (Exception ex)
            {
                Log("OnStart failed: " + ex);
                throw;
            }
        }

        protected override void OnStop()
        {
            try
            {
                Log("OnStop");
                if (_child != null && !_child.HasExited)
                {
                    try { _child.Kill(); } catch { }
                    _child.WaitForExit(10000);
                }
            }
            catch (Exception ex)
            {
                Log("OnStop error: " + ex.Message);
            }
        }

        private void Log(string line)
        {
            try
            {
                File.AppendAllText(_logPath, DateTime.UtcNow.ToString("o") + " " + line + Environment.NewLine);
            }
            catch { }
        }

        public static void Main(string[] args)
        {
            if (Environment.UserInteractive)
            {
                // Console mode for packaging/smoke (not SCM)
                var svc = new BrokerService();
                Console.WriteLine("Interactive smoke start (Ctrl+C to stop)...");
                svc.OnStart(args);
                Thread.Sleep(Timeout.Infinite);
            }
            else
            {
                ServiceBase.Run(new BrokerService());
            }
        }
    }
}
