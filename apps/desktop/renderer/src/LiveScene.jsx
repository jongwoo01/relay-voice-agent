import { AgentAvatar } from "./AgentAvatar.jsx";
import AvatarFieldLayer from "./AvatarFieldLayer.jsx";

export default function LiveScene({
  audioEnergy,
  avatarState,
  inputEnergy,
  mouthOpen,
  prefersReducedMotion
}) {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
        <AgentAvatar
          state={avatarState}
          inputEnergy={inputEnergy}
          mouthOpen={mouthOpen}
          speechEnergy={audioEnergy}
          reducedMotion={prefersReducedMotion}
        />
      </div>
    </>
  );
}
