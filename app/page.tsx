"use client";

import { useEffect, useRef, useState } from "react";
import io, { Socket } from "socket.io-client";

const ROOM_ID = "demo-room";
let socket: Socket;

export default function Home() {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [role, setRole] = useState<"sharer" | "viewer" | null>(null);

  const peerConnections = useRef<{ [key: string]: RTCPeerConnection }>({});
  const answerQueue = useRef<{ [key: string]: RTCSessionDescriptionInit[] }>({});

  // --- Initialize socket ---
  useEffect(() => {
    if (!socket) {
      socket = io("https://weatherradar.duckdns.org/", {
        transports: ["websocket"],
      });

      socket.on("connect", () => console.log("✅ Socket connected:", socket.id));
      socket.on("connect_error", (err) =>
        console.error("❌ Socket connect error:", err)
      );
    }
  }, []);

  // ✅ Auto start viewer when page loads
  useEffect(() => {
    const url = window.location.href;

    if (url.includes("?viewer")) {
      startViewing();
    }
  }, []);

  // --- Attach signaling events ---
  useEffect(() => {
    if (!socket) return;

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
      await pc.setLocalDescription(offer);
      console.log("Local description set for viewer:", viewerId);
      socket.emit("offer", { viewerId, offer });
    };

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

    const handleAnswer = async ({ answer, viewerId }: any) => {
      const pc = peerConnections.current[viewerId];
      if (!pc) return;

      console.log("📩 Received answer from viewer:", viewerId);

      const applyAnswer = async () => {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          console.log("✅ Remote description applied:", viewerId);
          pc.removeEventListener("signalingstatechange", applyAnswer);
        } catch (err) {
          console.error("❌ Failed to set remote description:", viewerId, err);
        }
      };

      if (pc.signalingState === "have-local-offer") {
        await applyAnswer();
      } else {
        pc.addEventListener("signalingstatechange", applyAnswer);
      }
    };

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

    return () => {
      socket.off("viewer-joined", handleViewerJoined);
      socket.off("offer", handleOffer);
      socket.off("answer", handleAnswer);
      socket.off("ice-candidate", handleIceCandidate);
    };
  }, [role]);

  // --- Peer connection with XIRSYS TURN ---
  const createPeerConnection = (targetId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: ["stun:fr-turn8.xirsys.com"],
        },
        {
          username:
            "GnTpLl-OzwrbegI8SLZGnt3XA1yT5wUJyVYFNEUh5Nl20LPVbP2CEmLRgTdE6-SGAAAAAGkPdz02MjgzMTc0OTk4",
          credential: "779f1952-bcc4-11f0-b390-3eafa8ba3f72",
          urls: [
            "turn:fr-turn8.xirsys.com:80?transport=udp",
            "turn:fr-turn8.xirsys.com:3478?transport=udp",
            "turn:fr-turn8.xirsys.com:80?transport=tcp",
            "turn:fr-turn8.xirsys.com:3478?transport=tcp",
            "turns:fr-turn8.xirsys.com:443?transport=tcp",
            "turns:fr-turn8.xirsys.com:5349?transport=tcp",
          ],
        },
      ],
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("ice-candidate", { target: targetId, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
    };

    return pc;
  };

  const startSharing = async () => {
    setRole("sharer");
    socket.emit("join-room", { roomId: ROOM_ID, role: "sharer" });

    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
  };

  const startViewing = async () => {
    setRole("viewer");
    socket.emit("join-room", { roomId: ROOM_ID, role: "viewer" });
    console.log("Viewer auto-joined");
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

        {/* Viewer button removed because viewer auto-starts */}
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
