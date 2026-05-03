import AVFoundation
import Foundation

/// Plays an inaudible audio loop while logging is active, to keep the app
/// from being suspended by iOS when the user switches to Maps / etc.
///
/// **Why this is necessary**: iOS suspends apps within seconds of going to
/// background, which would freeze the sampler. The `bluetooth-central`
/// background mode lets BLE delegate callbacks fire, but doesn't keep our
/// own polling loop alive — we have to actively send commands every tick,
/// not just react to incoming notifications. The `audio` background mode
/// keeps the entire app running as long as audio plays. A silent audio
/// session gives us that allowance without making any actual sound.
///
/// **App Store implications**: this technique is well-known and many
/// vehicle/sport-tracking apps use it. Apple's review may ask to justify
/// the `audio` background mode; the answer is "we keep the data-logging
/// session alive while the user navigates with Maps." For TestFlight
/// (which doesn't go through full App Review), this is fine. For App
/// Store distribution, expect a question on the review form.
@MainActor
final class SilentAudioSession {

    static let shared = SilentAudioSession()

    private let engine = AVAudioEngine()
    private var player: AVAudioPlayerNode?
    private(set) var isActive = false

    func start() {
        guard !isActive else { return }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)

            let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
            let player = AVAudioPlayerNode()
            self.player = player
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: format)
            try engine.start()

            // Loop a 1-second silent buffer indefinitely.
            let frameCount = AVAudioFrameCount(format.sampleRate)
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
                return
            }
            buffer.frameLength = frameCount
            // The buffer is zeroed by default — that's our silence.
            player.scheduleBuffer(buffer, at: nil, options: .loops, completionHandler: nil)
            player.play()
            isActive = true
        } catch {
            // Best effort; if this fails, foreground logging still works.
            NSLog("SilentAudioSession start failed: \(error)")
        }
    }

    func stop() {
        guard isActive else { return }
        player?.stop()
        engine.stop()
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            // ignore
        }
        isActive = false
    }
}
