# ORCA-X Google Colab GPU — exact quickstart

Your Windows project directory can remain:

```text
D:\Project\HackHeritage\Project\HackHeritage
```

That directory is not used by the Colab runtime. Colab runs a separate Linux copy under `/content/HackHeritage`.

## 1. Open the notebook

Open `ml/colab/ORCA_X_Refinements_GPU.ipynb` in Google Colab.

## 2. Select the GPU runtime

In Colab select **Runtime → Change runtime type → Hardware accelerator → GPU**. T4 or L4 is suitable.

## 3. Run the setup cells in order

Run Cell 1, Cell 2, Cell 3, then Cell 4.

Cell 1 always changes to `/content` before the repository is removed. This prevents the `getcwd: cannot access parent directories` error caused by deleting the directory that is currently the process working directory.

Cell 4 must end with:

```text
OK   NVIDIA GPU: ...
OK   XGBoost CUDA execution: tiny GPU fit/predict succeeded
PREFLIGHT PASSED — Colab GPU is ready for ORCA-X ML execution
```

If preflight fails, do not start a long training job.

## 4. Run the desired job

Canonical production model:

```python
!python ml/src/train.py
```

Refinement 26:

```python
!python ml/src/colab_gpu_runner.py ml/src/refinement26_uncertainty_aware_forecast.py
```

Refinement 25:

```python
!python ml/src/colab_gpu_runner.py ml/src/refinement25_temporal_reliability_forecast.py
```

Any other existing XGBoost training/refinement script:

```python
!python ml/src/colab_gpu_runner.py ml/src/<script>.py
```

Run one heavy job at a time.

## 5. If the dataset is missing

The project can rebuild its real historical Open-Meteo weather + marine dataset:

```python
!python ml/src/download_historical_marine.py
!python ml/src/prepare_dataset.py
```

Then run the desired model/refinement.

## 6. Do not run the Colab GPU job in Windows PowerShell

This runs on your Windows computer:

```powershell
cd D:\Project\HackHeritage\Project\HackHeritage
python ml/src/refinement26_uncertainty_aware_forecast.py
```

It does not use the Colab GPU. The GPU exists only inside the Colab runtime.

## 7. Results are temporary in Colab

`/content/HackHeritage` is a temporary Colab copy. Generated model/evaluation artifacts do not automatically appear in your Windows directory.

Download any artifact you need and copy it to the corresponding repository path, normally `ml/models/`.

Do not commit raw datasets or temporary Colab caches unless required by the project.

## 8. If Colab gets the deleted-directory error again

Run Cell 1 first. It explicitly executes `os.chdir('/content')` before touching `/content/HackHeritage`.

Never delete `/content/HackHeritage` while the notebook's current directory is `/content/HackHeritage`.
