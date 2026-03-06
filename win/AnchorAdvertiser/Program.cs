using System.Text;
using System.Text.RegularExpressions;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Devices.Bluetooth;
using Windows.Storage.Streams;

const string ServiceUuidText = "00001802-0000-1000-8000-00805f9b34fb";
const ushort ServiceUuid16 = 0x1802;

if (!TryParseAnchorId(args, out var anchorId))
{
    PrintUsage();
    return 2;
}

if (!Regex.IsMatch(anchorId, "^BLUEPOINT-[0-9]{2}$"))
{
    Console.Error.WriteLine($"Invalid anchor ID: {anchorId}");
    Console.Error.WriteLine("Expected: BLUEPOINT-01");
    return 2;
}

var exitSignal = new ManualResetEventSlim(false);
var startAck = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

BluetoothLEAdvertisementPublisher? publisher = null;

try
{
    var advertisement = new BluetoothLEAdvertisement();

    // Keep payload compact to fit legacy advertisement size limits on Windows.
    // Use Service Data - 16-bit UUID (AD type 0x16):
    // [serviceUuid16 (2 bytes LE)] + [payload UTF-8 bytes].
    //
    var payloadBytes = Encoding.UTF8.GetBytes(anchorId);
    var sectionBytes = new byte[2 + payloadBytes.Length];
    sectionBytes[0] = (byte)(ServiceUuid16 & 0xFF);
    sectionBytes[1] = (byte)((ServiceUuid16 >> 8) & 0xFF);
    System.Buffer.BlockCopy(payloadBytes, 0, sectionBytes, 2, payloadBytes.Length);

    var writer = new DataWriter();
    writer.WriteBytes(sectionBytes);
    advertisement.DataSections.Add(new BluetoothLEAdvertisementDataSection(0x16, writer.DetachBuffer()));

    publisher = new BluetoothLEAdvertisementPublisher(advertisement);
    publisher.StatusChanged += (_, e) =>
    {
        switch (e.Status)
        {
            case BluetoothLEAdvertisementPublisherStatus.Started:
                Console.WriteLine("Advertising started.");
                startAck.TrySetResult(true);
                break;
            case BluetoothLEAdvertisementPublisherStatus.Stopped:
                Console.WriteLine("Advertising stopped.");
                if (!startAck.Task.IsCompleted)
                {
                    startAck.TrySetException(new InvalidOperationException("Publisher stopped before starting."));
                }
                break;
            case BluetoothLEAdvertisementPublisherStatus.Aborted:
                Console.Error.WriteLine($"Advertising aborted. Bluetooth error: {e.Error}");
                startAck.TrySetException(new InvalidOperationException($"Publisher aborted: {e.Error}"));
                exitSignal.Set();
                break;
        }
    };

    Console.WriteLine($"Starting Windows anchor for {anchorId}...");
    Console.WriteLine($"Service UUID: {ServiceUuidText}");
    Console.WriteLine("Broadcast payload mode: compact service-data (16-bit UUID + BLUEPOINT id)");
    Console.WriteLine("Press Ctrl+C to stop.");

    publisher.Start();
    await startAck.Task.ConfigureAwait(false);

    Console.CancelKeyPress += (_, e) =>
    {
        e.Cancel = true;
        exitSignal.Set();
    };

    exitSignal.Wait();
    publisher.Stop();
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine($"Failed: {ex.Message}");
    publisher?.Stop();
    return 1;
}

static bool TryParseAnchorId(string[] args, out string anchorId)
{
    anchorId = string.Empty;
    for (var i = 0; i < args.Length; i++)
    {
        if (string.Equals(args[i], "--id", StringComparison.OrdinalIgnoreCase))
        {
            if (i + 1 >= args.Length)
            {
                return false;
            }

            anchorId = args[i + 1].Trim().ToUpperInvariant();
            return true;
        }
    }
    return false;
}

static void PrintUsage()
{
    Console.WriteLine("Usage: dotnet run --project AnchorAdvertiser -- --id BLUEPOINT-01");
}
