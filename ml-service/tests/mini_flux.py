"""Winziges, zufällig initialisiertes FLUX.2-klein-Pipeline-Verzeichnis für Tests (kein Download, wenige MB).

Gleiche Komponenten wie das echte Modell (Transformer, VAE, Qwen3-Textkodierer, Tokenizer, Scheduler), nur sehr klein;
die Bilder sind Rauschen, aber Laden, Aufruf mit Referenzbildern, Größen und Seeds verhalten sich wie beim echten Modell.
"""

import json
from pathlib import Path


def build(out: Path) -> Path:
    import torch
    from diffusers import AutoencoderKLFlux2, Flux2KleinPipeline, Flux2Transformer2DModel, FlowMatchEulerDiscreteScheduler
    from transformers import Qwen2Tokenizer, Qwen3Config, Qwen3ForCausalLM

    out.mkdir(parents=True, exist_ok=True)

    def bytes_to_unicode():
        bs = list(range(ord("!"), ord("~") + 1)) + list(range(ord("¡"), ord("¬") + 1)) + list(range(ord("®"), ord("ÿ") + 1))
        cs = bs[:]
        n = 0
        for b in range(256):
            if b not in bs:
                bs.append(b)
                cs.append(256 + n)
                n += 1
        return dict(zip(bs, [chr(c) for c in cs]))

    vocab = {ch: i for i, ch in enumerate(bytes_to_unicode().values())}
    for s in ("<|endoftext|>", "<|im_start|>", "<|im_end|>"):
        vocab[s] = len(vocab)
    tok_dir = out / "_tok"
    tok_dir.mkdir(exist_ok=True)
    (tok_dir / "vocab.json").write_text(json.dumps(vocab), encoding="utf-8")
    (tok_dir / "merges.txt").write_text("#version: 0.2\n", encoding="utf-8")
    tok = Qwen2Tokenizer(str(tok_dir / "vocab.json"), str(tok_dir / "merges.txt"), eos_token="<|im_end|>", pad_token="<|endoftext|>")
    tok.chat_template = (
        "{% for m in messages %}<|im_start|>{{ m['role'] }}\n{{ m['content'] }}<|im_end|>\n{% endfor %}"
        "{% if add_generation_prompt %}<|im_start|>assistant\n{% endif %}"
    )
    torch.manual_seed(0)
    h = 16
    cfg = Qwen3Config(
        vocab_size=len(vocab) + 8, hidden_size=h, intermediate_size=32, num_hidden_layers=28,
        num_attention_heads=2, num_key_value_heads=1, head_dim=8, max_position_embeddings=1024,
    )
    te = Qwen3ForCausalLM(cfg).eval()
    vae = AutoencoderKLFlux2(block_out_channels=(8, 8, 8, 8), layers_per_block=1, latent_channels=32, norm_num_groups=4, sample_size=64)
    tr = Flux2Transformer2DModel(
        patch_size=1, in_channels=128, num_layers=1, num_single_layers=1, attention_head_dim=16, num_attention_heads=2,
        joint_attention_dim=3 * h, timestep_guidance_channels=32, axes_dims_rope=(4, 4, 4, 4), guidance_embeds=False,
    )
    pipe = Flux2KleinPipeline(
        scheduler=FlowMatchEulerDiscreteScheduler(), vae=vae, text_encoder=te, tokenizer=tok, transformer=tr, is_distilled=True
    )
    pipe.save_pretrained(out)
    return out
