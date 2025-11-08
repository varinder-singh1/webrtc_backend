"use client";
import { useEffect, useRef, useState } from "react";
import io, { Socket } from "socket.io-client";

const ROOM_ID = "demo-room";
let socket: Socket;

export default function Home() {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [role, setRole] = useState<"sharer" | "viewer" | null>(null);

  // Store peer connections per target
  const peerConnections = useRef<{ [key: string]: RTCPeerConnection }>({});
  // Queue remote answers if peer is not ready
  const answerQueue = useRef<{ [key: string]: RTCSessionDescriptionInit[] }>({});

  // Initialize socket once
  useEffect(() => {
    if (!socket) {
      socket = io("https://weatherradar.duckdns.org/");
      socket.on("connect", () => console.log("✅ Socket connected:------", socket.id));
    }
  }, []);

  // Attach signaling events once
  useEffect(() => {
    if (!socket) return;

    // --- SHARER: Viewer joined ---
    const handleViewerJoined = async (viewerId: string) => {
      if (role !== "sharer") return;
      console.log("👀 Viewer joined:", viewerId);

      const pc = createPeerConnection(viewerId);
      peerConnections.current[viewerId] = pc;
      answerQueue.current[viewerId] = [];

      const stream = localVideoRef.current?.srcObject as MediaStream | null;
      if (stream) {
        console.log("Adding local tracks to peer:", viewerId);
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      }

      const offer = await pc.createOffer();
      console.log("Created offer for viewer:", viewerId, offer.sdp?.slice(0, 50), "...");
      await pc.setLocalDescription(offer);
      console.log("Local description set for viewer:", viewerId);
      socket.emit("offer", { viewerId, offer });
    };

    // --- VIEWER: Receive offer ---
    const handleOffer = async ({ offer, sharerId }: any) => {
      if (role !== "viewer") return;
      console.log("📩 Received offer from sharer:", sharerId);

      const pc = createPeerConnection(sharerId);
      peerConnections.current[sharerId] = pc;

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      console.log("Remote description set from sharer:", sharerId);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log("Local answer created and set for sharer:", sharerId);

      socket.emit("answer", { sharerId, answer });
    };

    // --- SHARER: Receive answer ---
    const handleAnswer = async ({ answer, viewerId }: any) => {
      const pc = peerConnections.current[viewerId];
      if (!pc) return;

      console.log("📩 Received answer from viewer:", viewerId, "signalingState:", pc.signalingState);

      const applyAnswer = async () => {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          console.log("✅ Remote description set successfully for viewer:", viewerId);
          pc.removeEventListener("signalingstatechange", applyAnswer);
        } catch (err) {
          console.error("❌ Failed to set remote description for viewer:", viewerId, err);
        }
      };

      if (pc.signalingState === "have-local-offer") {
        await applyAnswer();
      } else {
        console.log("Waiting for peer to be ready before setting remote description:", viewerId);
        pc.addEventListener("signalingstatechange", applyAnswer);
      }
    };

    // --- ICE candidate ---
    const handleIceCandidate = ({ candidate, from }: any) => {
      const pc = peerConnections.current[from];
      if (pc && candidate) {
        pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("Added ICE candidate from:", from);
      }
    };

    socket.on("viewer-joined", handleViewerJoined);
    socket.on("offer", handleOffer);
    socket.on("answer", handleAnswer);
    socket.on("ice-candidate", handleIceCandidate);

    // Cleanup
    return () => {
      socket.off("viewer-joined", handleViewerJoined);
      socket.off("offer", handleOffer);
      socket.off("answer", handleAnswer);
      socket.off("ice-candidate", handleIceCandidate);
    };
  }, [role]);

  // --- Create peer connection ---
  const createPeerConnection = (targetId: string) => {
    const pc = new RTCPeerConnection();

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("ice-candidate", { target: targetId, candidate: e.candidate });
        console.log("Sent ICE candidate to:", targetId);
      }
    };

    pc.ontrack = (e) => {
      console.log("Received remote track from:", targetId);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
    };

    pc.onconnectionstatechange = () => {
      console.log(`Peer connection state with ${targetId}:`, pc.connectionState);
    };

    pc.onsignalingstatechange = () => {
      console.log(`Peer signaling state with ${targetId}:`, pc.signalingState);
    };

    return pc;
  };

  // --- Start sharing ---
  const startSharing = async () => {
    setRole("sharer");
    socket.emit("join-room", { roomId: ROOM_ID, role: "sharer" });
    console.log("Starting screen sharing...");

    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      console.log("Local stream set for sharing");
    }
  };

  // --- Start viewing ---
  const startViewing = async () => {
    setRole("viewer");
    socket.emit("join-room", { roomId: ROOM_ID, role: "viewer" });
    console.log("Joined room as viewer");
  };

  return (
    <div className="flex flex-col items-center gap-4 p-4">
      <h1 className="text-2xl font-bold">WebRTC Screen Sharing</h1>
      <div className="flex gap-4">
        <button
          onClick={startSharing}
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded"
        >
          Start Sharing
        </button>
        <button
          onClick={startViewing}
          className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded"
        >
          Start Viewing
        </button>
      </div>

      <div className="mt-6 flex flex-col items-center">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-96 border rounded"
        />
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-96 border rounded mt-4"
        />
      </div>
    </div>
  );
}
