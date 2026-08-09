// R6.5.2 Owner Approval Helper — requires UAC elevation.
// Writes a bounded approval request into broker-private inbox.
// Does NOT execute PowerShell/cmd/scripts. Does NOT read or print secrets.
// Manifest: requireAdministrator

using System;
using System.Diagnostics;
using System.IO;
using System.Security.Principal;
using System.Text;

namespace Aion.ElevatedOperatorBroker
{
    public static class OwnerApprovalHelper
    {
        private const string Inbox =
            @"C:\ProgramData\AION\ElevatedOperatorBroker\private\owner-approval-inbox";

        public static int Main(string[] args)
        {
            try
            {
                if (!IsElevated())
                {
                    Console.Error.WriteLine("Owner Approval Helper must run elevated (UAC).");
                    return 2;
                }

                string authorizationId = null, envelopeDigest = null, approvalNonce = null;
                string directiveId = null, repositoryRoot = null;
                foreach (var a in args)
                {
                    if (a.StartsWith("--authorizationId=", StringComparison.Ordinal))
                        authorizationId = a.Substring("--authorizationId=".Length);
                    else if (a.StartsWith("--envelopeDigest=", StringComparison.Ordinal))
                        envelopeDigest = a.Substring("--envelopeDigest=".Length);
                    else if (a.StartsWith("--approvalNonce=", StringComparison.Ordinal))
                        approvalNonce = a.Substring("--approvalNonce=".Length);
                    else if (a.StartsWith("--directiveId=", StringComparison.Ordinal))
                        directiveId = a.Substring("--directiveId=".Length);
                    else if (a.StartsWith("--repositoryRoot=", StringComparison.Ordinal))
                        repositoryRoot = a.Substring("--repositoryRoot=".Length);
                    else if (a == "--help" || a == "-h")
                    {
                        Console.WriteLine("AionOwnerApprovalHelper — bounded Owner UAC approval only.");
                        return 0;
                    }
                }

                if (string.IsNullOrEmpty(authorizationId) || string.IsNullOrEmpty(envelopeDigest)
                    || string.IsNullOrEmpty(approvalNonce) || string.IsNullOrEmpty(directiveId)
                    || string.IsNullOrEmpty(repositoryRoot))
                {
                    Console.Error.WriteLine("Missing required bounded fields.");
                    return 3;
                }

                // Refuse free-form scriptish payloads
                if (ContainsShellSmuggle(authorizationId) || ContainsShellSmuggle(envelopeDigest)
                    || ContainsShellSmuggle(approvalNonce) || ContainsShellSmuggle(directiveId)
                    || ContainsShellSmuggle(repositoryRoot))
                {
                    Console.Error.WriteLine("Refused suspicious payload.");
                    return 4;
                }

                if (!Directory.Exists(Inbox))
                    Directory.CreateDirectory(Inbox);

                var id = Guid.NewGuid().ToString("N").Substring(0, 16);
                var path = Path.Combine(Inbox, id + ".json");
                var utc = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
                var json = new StringBuilder();
                json.AppendLine("{");
                json.AppendLine("  \"schemaVersion\": \"aion.owner-approval-inbox.v1\",");
                json.AppendLine("  \"authorizationId\": " + Json(authorizationId) + ",");
                json.AppendLine("  \"envelopeDigest\": " + Json(envelopeDigest) + ",");
                json.AppendLine("  \"approvalNonce\": " + Json(approvalNonce) + ",");
                json.AppendLine("  \"directiveId\": " + Json(directiveId) + ",");
                json.AppendLine("  \"repositoryRoot\": " + Json(repositoryRoot) + ",");
                json.AppendLine("  \"requestedAtUtc\": " + Json(utc) + ",");
                json.AppendLine("  \"helperPid\": " + Process.GetCurrentProcess().Id + ",");
                json.AppendLine("  \"elevated\": true");
                json.AppendLine("}");
                var tmp = path + ".tmp";
                File.WriteAllText(tmp, json.ToString(), new UTF8Encoding(false));
                if (File.Exists(path)) File.Delete(path);
                File.Move(tmp, path);
                Console.WriteLine("Owner approval request submitted to broker private inbox.");
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Helper failed: " + ex.Message);
                return 1;
            }
        }

        private static bool IsElevated()
        {
            using (var id = WindowsIdentity.GetCurrent())
            {
                var p = new WindowsPrincipal(id);
                return p.IsInRole(WindowsBuiltInRole.Administrator);
            }
        }

        private static bool ContainsShellSmuggle(string s)
        {
            if (string.IsNullOrEmpty(s)) return true;
            var u = s.ToUpperInvariant();
            return u.Contains("ENCODEDCOMMAND") || u.Contains("POWERSHELL")
                || u.Contains("CMD.EXE") || u.Contains("&&") || u.Contains("|")
                || s.IndexOf('\0') >= 0;
        }

        private static string Json(string s)
        {
            return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        }
    }
}
