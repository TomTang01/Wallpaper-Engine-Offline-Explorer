using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

internal static class Launcher
{
    private const string Url = "http://127.0.0.1:43196/";

    [STAThread]
    private static void Main()
    {
        string appDirectory = AppDomain.CurrentDomain.BaseDirectory;
        string serverPath = Path.Combine(appDirectory, "server.js");

        if (!File.Exists(serverPath))
        {
            MessageBox.Show(
                "server.js was not found next to the launcher.",
                "Wallpaper Engine Offline Explorer",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        if (!IsServerReady())
        {
            if (!StartServer(appDirectory, serverPath))
            {
                return;
            }

            if (!WaitForServer())
            {
                MessageBox.Show(
                    "The local server did not start on http://127.0.0.1:43196.",
                    "Wallpaper Engine Offline Explorer",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return;
            }
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = Url,
            UseShellExecute = true
        });
    }

    private static bool StartServer(string appDirectory, string serverPath)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "node",
                Arguments = "\"" + serverPath + "\"",
                WorkingDirectory = appDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            });
            return true;
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "Could not start Node.js. Make sure Node is installed and available on PATH.\n\n" + ex.Message,
                "Wallpaper Engine Offline Explorer",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return false;
        }
    }

    private static bool WaitForServer()
    {
        for (int i = 0; i < 80; i++)
        {
            if (IsServerReady()) return true;
            Thread.Sleep(125);
        }

        return false;
    }

    private static bool IsServerReady()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Url + "api/config");
            request.Method = "GET";
            request.Timeout = 500;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            {
                return response.StatusCode == HttpStatusCode.OK;
            }
        }
        catch
        {
            return false;
        }
    }
}
