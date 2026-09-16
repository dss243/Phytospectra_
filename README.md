#  PhytoSpectra

<p align="center">
  <img src="Phytospectra/public/logowithoutbackground" alt="PhytoSpectra Logo" width="380"/>
</p>

<h3 align="center">
  AI-Powered Multispectral Water-Stress Detection for Potato Crops
</h3>

<p align="center">
  <strong>Early crop stress analysis for smarter irrigation decisions.</strong>
</p>

---

## 📌 Overview

**PhytoSpectra** is a precision agriculture platform designed to detect **water stress in potato crops before visible symptoms appear**.

The platform combines multispectral imaging, deep learning, and a monitoring dashboard to analyze crop conditions and support more informed irrigation decisions.

PhytoSpectra focuses on two complementary computer vision tasks:

* **Plant-level water-stress classification** using a Vision Transformer.
* **Region-level stress segmentation** using SegFormer.

---

## Platform Preview

<p align="center">
  <img src="Phytospectra/public/landingpage1" alt="PhytoSpectra landing page - view 1" width="90%"/>
</p>

<p align="center">
  <img src="Phytospectra/public/landingpage2" alt="PhytoSpectra landing page - view 2" width="90%"/>
</p>

<p align="center">
  <img src="Phytospectra/public/landingpage3" alt="PhytoSpectra landing page - view 3" width="90%"/>
</p>

---

##  Project Objectives

PhytoSpectra aims to:

* Detect early signs of water stress in potato plants.
* Analyze multispectral crop imagery.
* Classify plant conditions using deep learning.
* Identify and segment stressed regions.
* Support irrigation monitoring and decision-making.
* Present crop information through an accessible web platform.

---

## AI Pipeline

PhytoSpectra uses two complementary deep learning models for different levels of analysis.

### 1. Plant-Level Classification — Vision Transformer

A **Vision Transformer (ViT)** is used to classify potato plant images according to their water-stress condition.

The model uses multispectral information, including:

* Red
* Green
* Near-Infrared — NIR
* Normalized Difference Vegetation Index — NDVI

The model directly predicts the water-stress class of the input plant image.

**Classification accuracy: 84.76%**

### 2. Region-Level Segmentation — SegFormer

A **SegFormer-B0** model is used to segment regions associated with water stress in crop imagery.

The segmentation model uses spectral information including:

* Red
* Green
* NDVI

It produces pixel-level predictions for healthy and stressed regions.

**Mean Intersection over Union: 0.7240 mIoU**

### 🔄 Complementary Model Workflow

```text
                  Multispectral Imagery
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
       Vision Transformer           SegFormer-B0
              │                         │
              ▼                         ▼
      Plant-Level Classification   Region-Level Segmentation
              │                         │
              └────────────┬────────────┘
                           ▼
                Water-Stress Analysis
                           │
                           ▼
              Irrigation Decision Support
```

---

## 📊 Model Results

| Model                    | Task                                    | Input Features        |         Performance |
| ------------------------ | --------------------------------------- | --------------------- | ------------------: |
| Vision Transformer — ViT | Plant-level water-stress classification | Red, Green, NIR, NDVI | **84.76% accuracy** |
| SegFormer-B0             | Region-level stress segmentation        | Red, Green, NDVI      |     **0.7240 mIoU** |

---

##  System Concept

The proposed platform combines UAV-based multispectral imaging with AI-powered analysis.

```text
Field Data Collection
        │
        ▼
UAV + Multispectral Camera
        │
        ▼
Multispectral Crop Images
        │
        ▼
Image Preprocessing
        │
        ├───────────────┐
        ▼               ▼
      ViT          SegFormer-B0
        │               │
        ▼               ▼
Plant Classification  Stress Segmentation
        │               │
        └───────┬───────┘
                ▼
       Crop Stress Analysis
                │
                ▼
       Monitoring Dashboard
                │
                ▼
      Irrigation Decision Support
```

---

##  Technologies

### Artificial Intelligence and Computer Vision

* Python
* PyTorch
* Hugging Face Transformers
* Vision Transformer — ViT
* SegFormer
* DINOv2
* OpenCV

### Multispectral Image Processing

* RGB and NIR imagery
* NDVI computation
* Image preprocessing
* Data augmentation
* Pixel-level segmentation

### Platform and IoT Components

* React
* ESP32
* Supabase
* UAV-based image acquisition
* Web-based monitoring dashboard

---


##  Future Development

Future improvements may include:

* Automated UAV flight missions.
* Field-level water-stress maps.
* Real-time multispectral image transfer.
* Cloud-based model inference.
* ESP32-based communication.
* Dashboard alerts for potentially stressed areas.
* Integration with irrigation planning workflows.

---
## 🎥 Platform Demo

See PhytoSpectra in action in the following demonstration video:

**[▶️ Watch the PhytoSpectra Platform Demo](https://drive.google.com/file/d/1-lZkVAkfsAV1eqZdB5yzFpoab6us-sly/view?usp=sharing)**

<p align="center">
  <img src="Phytospectra/public/mvp" alt="PhytoSpectra mvp" width="380"/>
</p>
The video demonstrates the main platform workflow, including the user interface and how the different components of PhytoSpectra are used for crop monitoring and water-stress analysis.

---

<p align="center">
   <strong>PhytoSpectra — Turning multispectral data into actionable crop insights.</strong>
</p>
