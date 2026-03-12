export class AssetCreatedEvent {
  constructor(
    public readonly assetId: string,
    public readonly assetName: string,
    public readonly performedBy: string,
    public readonly serialNumber: string,
    public readonly assetTypeName: string,
    public readonly quantity: number,
    public readonly timestamp: Date = new Date(),
  ) {}
}
