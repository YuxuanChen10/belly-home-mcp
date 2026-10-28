# Belly Receiver — PhotoKit proof of concept

This standalone iPadOS app tests saving one bundled PNG to Photos. It has no Gateway connection, network code, background mode, or dependency on the iPhone Alarm app.

## Build and run on an iPad

1. Use Xcode 26 or newer and an iPad running iPadOS 17 or newer.
2. Open `iPadReceiver.xcodeproj`, select the **iPadReceiver** target, and check **Signing & Capabilities**. The project uses the Apple Development team currently available on this Mac; choose another team or bundle ID if Xcode requests it.
3. Connect and trust the iPad, enable Developer Mode if prompted, select it as the run destination, and press **Run**.
4. In Belly Receiver, confirm Photos permission says **Not requested**, then tap **Save Test Image**. Grant **Add Photos Only** when iPadOS asks.
5. Wait for **Success**, then open Photos and locate the magenta and cyan test image in Recents.
6. Return to Belly Receiver and tap **Save Test Image** again. Confirm another image appears without a new authorization prompt.
7. To check denial handling, change the app's Photos permission to **None** in iPad Settings, return to the app, and tap the button. It should show **Failed** with a readable message.

The app reports success only after PhotoKit's change completion confirms it. Physical iPad permission and Photos behavior must be checked on device; a simulator or an unsigned build does not establish those results.
