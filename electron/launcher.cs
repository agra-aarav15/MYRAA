using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("MYRAA")]
[assembly: AssemblyDescription("MYRAA Desktop Companion Launcher")]
[assembly: AssemblyProduct("MYRAA")]
[assembly: AssemblyCompany("MYRAA")]
[assembly: AssemblyCopyright("Copyright © 2026 MYRAA")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        string baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
        string runtimePath = Path.Combine(baseDirectory, "MYRAA-runtime.exe");

        if (!File.Exists(runtimePath))
        {
            MessageBox.Show(
                "MYRAA-runtime.exe is missing. Reinstall MYRAA and try again.",
                "MYRAA failed to start",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }

        try
        {
            // Electron rejects several globally configured Node flags before the
            // JavaScript main process starts. Keep those flags out of MYRAA while
            // leaving the user's system-wide configuration untouched.
            Environment.SetEnvironmentVariable("NODE_OPTIONS", null, EnvironmentVariableTarget.Process);
            Environment.SetEnvironmentVariable("ELECTRON_RUN_AS_NODE", null, EnvironmentVariableTarget.Process);

            var startInfo = new ProcessStartInfo
            {
                FileName = runtimePath,
                Arguments = JoinArguments(args),
                WorkingDirectory = baseDirectory,
                UseShellExecute = false,
            };
            Process.Start(startInfo);
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "MYRAA could not be launched.\r\n\r\n" + error.Message,
                "MYRAA failed to start",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
    }

    private static string JoinArguments(string[] args)
    {
        if (args == null || args.Length == 0) return string.Empty;
        var quoted = new string[args.Length];
        for (int index = 0; index < args.Length; index++)
        {
            string value = args[index] ?? string.Empty;
            quoted[index] = "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        }
        return string.Join(" ", quoted);
    }
}
